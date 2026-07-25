import { Router } from "express";
import { Prisma } from "@prisma/client";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { z } from "zod";

import { getJwtSecret } from "../auth/jwt.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { calculateAttendanceWarning } from "./warnings.js";
import { broadcastAttendanceState, endSessionRealtime, getAttendanceCounters, previousQrTokenGracePeriodMs, startSessionRealtime } from "./realtime.js";
import { prisma } from "../prisma/client.js";
import { haversineDistanceMeters } from "./geofence.js";
import { nonReviewableFailureCodes } from "./review-policy.js";

const attendanceRouter = Router();

const startSessionSchema = z.object({
  course_id: z.number().int().positive(),
  section: z.string().trim().min(1).max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius: z.number().int().min(1).max(500).default(40),
  expires_at: z.string().datetime().optional()
});

const endSessionSchema = z.object({
  session_id: z.number().int().positive()
});

const scanSchema = z.object({
  qr_payload: z.string().min(1).max(10_000),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  device_id: z.string().trim().min(1).max(255)
});

const sessionIdParamSchema = z.coerce.number().int().positive();
const attemptIdParamSchema = z.coerce.number().int().positive();
const universityStudentIdParamSchema = z.string().trim().min(1).max(255);
const reportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  course_id: z.coerce.number().int().positive().optional(),
  section: z.string().trim().min(1).max(255).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone_offset_minutes: z.coerce.number().int().min(-840).max(840).default(0)
}).refine((query) => Boolean(query.course_id) === Boolean(query.section), {
  message: "course_id and section must be provided together"
}).refine((query) => !query.date_from || !query.date_to || query.date_from <= query.date_to, {
  message: "date_from must be on or before date_to"
});

function localDateBoundary(date: string, timezoneOffsetMinutes: number, endOfDay: boolean): Date {
  const [year, month, day] = date.split("-").map(Number);
  const localCalendarTime = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);

  // Date#getTimezoneOffset is UTC minus local time. Adding it converts the
  // calendar date picked on the device into the equivalent UTC boundary.
  return new Date(localCalendarTime + timezoneOffsetMinutes * 60_000);
}

const exportQuerySchema = z.object({
  course_id: z.coerce.number().int().positive().optional(),
  section: z.string().trim().min(1).max(255).optional()
}).refine((query) => Boolean(query.course_id) === Boolean(query.section), {
  message: "course_id and section must be provided together"
});

interface ScanTokenClaims extends JwtPayload {
  session_id: number;
  course_id: number;
  section: string;
  issued_at: number;
}

function isScanTokenClaims(payload: string | JwtPayload): payload is ScanTokenClaims {
  return typeof payload !== "string" &&
    Number.isInteger(payload.session_id) &&
    Number.isInteger(payload.course_id) &&
    typeof payload.section === "string" &&
    Number.isInteger(payload.issued_at);
}

const softFailureCodes = ["TOKEN_STALE", "DEVICE_NOT_REGISTERED", "DEVICE_MISMATCH", "OUTSIDE_GEOFENCE"] as const;

function isSoftFailureCode(code: string): boolean {
  return softFailureCodes.includes(code as typeof softFailureCodes[number]);
}

function splitReasonCodes(reasonCode: string | null): string[] {
  return reasonCode?.split("|").filter(Boolean) ?? [];
}

function professorFailureHeading(code: string, distanceMeters: number | null, radius: number): string | null {
  if (code === "DEVICE_NOT_REGISTERED" || code === "DEVICE_MISMATCH") return "Device mismatch";
  if (code === "TOKEN_STALE") return "Stale QR token";
  if (code === "OUTSIDE_GEOFENCE") {
    const metersOver = Math.max(0, Math.round((distanceMeters ?? radius) - radius));
    return `Out of range by ${metersOver}m`;
  }
  return null;
}

async function recordDuplicateScan(input: {
  sessionId: number;
  studentId: number;
  deviceId: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
}) {
  await prisma.scanAttempt.create({
    data: {
      sessionId: input.sessionId,
      studentId: input.studentId,
      result: "ignored",
      reasonCode: "DUPLICATE_ATTENDANCE",
      reasonMessage: "Student was already confirmed present for this session.",
      reviewStatus: "not_required",
      deviceId: input.deviceId,
      latitude: input.latitude,
      longitude: input.longitude,
      distanceMeters: input.distanceMeters
    }
  });
}

attendanceRouter.get("/assignments", requireAuth, requireRole("professor"), async (request, response, next) => {
  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id } });

    if (!professor) {
      response.status(403).json({ error: "Professor profile not found" });
      return;
    }

    const assignments = await prisma.courseProfessor.findMany({
      where: { professorId: professor.id },
      include: { course: { select: { id: true, courseCode: true, courseName: true } } },
      orderBy: [{ courseId: "asc" }, { section: "asc" }]
    });

    response.json({
      assignments: assignments.flatMap((assignment) => assignment.course ? [{
        course_id: assignment.course.id,
        course_code: assignment.course.courseCode,
        course_name: assignment.course.courseName,
        section: assignment.section
      }] : [])
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/active", requireAuth, requireRole("professor"), async (request, response, next) => {
  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id } });

    if (!professor) {
      response.status(403).json({ error: "Professor profile not found" });
      return;
    }

    const session = await prisma.attendanceSession.findFirst({
      where: { professorId: professor.id, status: "active" },
      orderBy: { createdAt: "desc" },
      include: { course: { select: { id: true, courseCode: true, courseName: true } } }
    });

    const counters = session?.courseId
      ? await getAttendanceCounters(session.courseId, session.section, session.id)
      : { presentCount: 0, pendingCount: 0, flaggedCount: 0 };
    response.json({
      session: session && session.course ? {
        session_id: session.id,
        course_id: session.course.id,
        course_code: session.course.courseCode,
        course_name: session.course.courseName,
        section: session.section,
        created_at: session.createdAt,
        expires_at: session.expiresAt,
        status: session.status,
        present_count: counters.presentCount,
        pending_count: counters.pendingCount,
        flagged_count: counters.flaggedCount
      } : null
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/scan", requireAuth, requireRole("student"), async (request, response, next) => {
  try {
    const student = await prisma.student.findUnique({ where: { userId: request.user!.user_id } });
    if (!student) {
      response.status(404).json({ code: "STUDENT_NOT_FOUND", error: "Student profile not found." });
      return;
    }

    const parsed = scanSchema.safeParse(request.body);
    const inputMetadata = {
      deviceId: typeof request.body?.device_id === "string" ? request.body.device_id : null,
      latitude: typeof request.body?.latitude === "number" ? request.body.latitude : null,
      longitude: typeof request.body?.longitude === "number" ? request.body.longitude : null
    };
    const rejectAttempt = async (
      httpStatus: number,
      code: string,
      message: string,
      sessionId: number | null = null,
      distanceMeters: number | null = null,
      options: { reviewable?: boolean; storedReasonCode?: string; confidenceScore?: number | null } = {}
    ) => {
      // Only an exact course-section enrollment can create a reviewable flag.
      // Hard rejections are always retained as audit-only attempts.
      const isReviewable = options.reviewable === true && !nonReviewableFailureCodes.includes(code);
      await prisma.scanAttempt.create({
        data: {
          sessionId,
          studentId: student.id,
          result: "failed",
          reasonCode: options.storedReasonCode ?? code,
          reasonMessage: message,
          confidenceScore: isReviewable ? options.confidenceScore ?? null : null,
          reviewStatus: isReviewable ? "pending" : "not_required",
          distanceMeters,
          ...inputMetadata
        }
      });
      if (sessionId && isReviewable) {
        await broadcastAttendanceState(sessionId);
      }
      response.status(httpStatus).json({ code, error: message });
    };

    if (!parsed.success) {
      await rejectAttempt(400, "SCAN_INVALID", "Scan request is missing valid QR, location, or device data.");
      return;
    }

    let qrEnvelope: { session_id?: unknown; course_id?: unknown; section?: unknown; token?: unknown } | null = null;
    let tokenClaims: ScanTokenClaims;
    let rawToken: string;
    try {
      qrEnvelope = JSON.parse(parsed.data.qr_payload) as { session_id?: unknown; course_id?: unknown; section?: unknown; token?: unknown };
      if (typeof qrEnvelope.token !== "string") {
        throw new Error("QR token is missing");
      }
      rawToken = qrEnvelope.token;
      let verified: string | JwtPayload;
      try {
        verified = jwt.verify(rawToken, getJwtSecret());
      } catch (error) {
        // A signed but expired QR still identifies a session. It is a soft
        // timing signal, unlike malformed data or a bad signature.
        if (!(error instanceof jwt.TokenExpiredError)) throw error;
        verified = jwt.verify(rawToken, getJwtSecret(), { ignoreExpiration: true });
      }
      if (!isScanTokenClaims(verified) ||
        qrEnvelope.session_id !== verified.session_id ||
        qrEnvelope.course_id !== verified.course_id ||
        qrEnvelope.section !== verified.section) {
        throw new Error("QR token claims do not match its envelope");
      }
      tokenClaims = verified;
    } catch {
      const referencedSessionId = typeof qrEnvelope?.session_id === "number" && Number.isInteger(qrEnvelope.session_id)
        ? qrEnvelope.session_id
        : null;
      await rejectAttempt(401, "TOKEN_INVALID", "This QR token is invalid, malformed, or expired.", referencedSessionId);
      return;
    }

    // Identify the session before evaluating the three soft checks together.
    const session = await prisma.attendanceSession.findUnique({
      where: { id: tokenClaims.session_id },
      include: { course: { select: { courseCode: true } } }
    });
    if (!session) {
      await rejectAttempt(409, "TOKEN_STALE", "This QR token is no longer current. Scan the latest code.");
      return;
    }

    // Enrollment is a hard boundary gate before any reviewable soft signal.
    const courseEnrollment = await prisma.courseStudent.findFirst({
      where: { studentId: student.id, courseId: session.courseId },
      select: { section: true }
    });
    const isExactEnrollment = Boolean(courseEnrollment && courseEnrollment.section === session.section);

    const currentTokenMatches = session.status === "active" &&
      session.qrToken === rawToken &&
      session.courseId === tokenClaims.course_id &&
      session.section === tokenClaims.section;
    const previousTokenIsWithinGracePeriod = Boolean(
      session.status === "active" &&
      session.previousQrToken === rawToken &&
      session.previousQrTokenRotatedAt &&
      Date.now() - session.previousQrTokenRotatedAt.getTime() <= previousQrTokenGracePeriodMs &&
      session.courseId === tokenClaims.course_id &&
      session.section === tokenClaims.section
    );
    const qrTimingScore = currentTokenMatches ? 100 : previousTokenIsWithinGracePeriod ? 70 : 20;

    if (!courseEnrollment) {
      await rejectAttempt(403, "NOT_ENROLLED", "You are not enrolled in this course.", session.id);
      return;
    }
    if (!isExactEnrollment) {
      await rejectAttempt(
        403,
        "SECTION_MISMATCH",
        `Section mismatch: you are enrolled in section ${courseEnrollment.section}, but this session is for section ${session.section}.`,
        session.id
      );
      return;
    }

    // The soft checks deliberately all run for an exactly enrolled student.
    // Their combined outcome gives professors enough context to review a flag.
    const distanceMeters = haversineDistanceMeters(
      { latitude: parsed.data.latitude, longitude: parsed.data.longitude },
      { latitude: session.latitude, longitude: session.longitude }
    );
    const radius = session.radius ?? 40;
    const deviceScore = student.deviceId && student.deviceId === parsed.data.device_id ? 100 : 0;
    const geofenceScore = distanceMeters <= radius ? 100 : Math.max(0, 100 - 2 * (distanceMeters - radius));
    const failures: Array<{ code: string; message: string }> = [];
    if (!currentTokenMatches && !previousTokenIsWithinGracePeriod) {
      failures.push({ code: "TOKEN_STALE", message: "This QR token is no longer current. Scan the latest code." });
    }
    if (deviceScore === 0) {
      failures.push({
        code: student.deviceId ? "DEVICE_MISMATCH" : "DEVICE_NOT_REGISTERED",
        message: student.deviceId
          ? "This scan came from a device that does not match your registered device."
          : "This device is not registered for your account."
      });
    }
    if (distanceMeters > radius) {
      failures.push({
        code: "OUTSIDE_GEOFENCE",
        message: `You are outside the attendance area (${Math.round(distanceMeters)}m away; radius is ${radius}m).`
      });
    }

    if (failures.length > 0) {
      const confidenceScore = Math.max(5, Math.round(deviceScore * 0.5 + geofenceScore * 0.35 + qrTimingScore * 0.15));
      await rejectAttempt(
        403,
        failures[0].code,
        failures.map((failure) => failure.message).join(" "),
        session.id,
        distanceMeters,
        {
          reviewable: true,
          storedReasonCode: failures.map((failure) => failure.code).join("|"),
          confidenceScore
        }
      );
      return;
    }

    // No student can receive more than one mark per session.
    const duplicate = await prisma.attendance.findUnique({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      select: { id: true }
    });
    if (duplicate) {
      await recordDuplicateScan({
        sessionId: session.id,
        studentId: student.id,
        deviceId: parsed.data.device_id,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        distanceMeters
      });
      response.json({
        status: "already_present",
        session: {
          course_id: tokenClaims.course_id,
          course_code: session.course?.courseCode ?? `Course ${tokenClaims.course_id}`,
          section: tokenClaims.section
        },
        distance_meters: Math.round(distanceMeters)
      });
      return;
    }

    // 7. Audit the successful attempt first, then create confirmed attendance atomically.
    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.scanAttempt.create({
          data: {
            sessionId: session.id,
            studentId: student.id,
            result: "success",
            reviewStatus: "not_required",
            distanceMeters,
            deviceId: parsed.data.device_id,
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude
          }
        });
        await transaction.attendance.create({
          data: { sessionId: session.id, studentId: student.id, status: "present", manualOverride: false }
        });
        // A later successful scan resolves earlier technical failures for the
        // same student/session while preserving every audit row.
        await transaction.scanAttempt.updateMany({
          where: {
            sessionId: session.id,
            studentId: student.id,
            result: "failed",
            reviewStatus: "pending",
            reasonCode: { notIn: nonReviewableFailureCodes }
          },
          data: { reviewStatus: "resolved", reviewedAt: new Date() }
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await recordDuplicateScan({
          sessionId: session.id,
          studentId: student.id,
          deviceId: parsed.data.device_id,
          latitude: parsed.data.latitude,
          longitude: parsed.data.longitude,
          distanceMeters
        });
        response.json({
          status: "already_present",
          session: {
            course_id: tokenClaims.course_id,
            course_code: session.course?.courseCode ?? `Course ${tokenClaims.course_id}`,
            section: tokenClaims.section
          },
          distance_meters: Math.round(distanceMeters)
        });
        return;
      }
      throw error;
    }

    await broadcastAttendanceState(session.id);
    response.status(201).json({
      status: "present",
      session: {
        course_id: tokenClaims.course_id,
        course_code: session.course?.courseCode ?? `Course ${tokenClaims.course_id}`,
        section: tokenClaims.section
      },
      distance_meters: Math.round(distanceMeters)
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/sessions/:sessionId", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedSessionId = sessionIdParamSchema.safeParse(request.params.sessionId);
  if (!parsedSessionId.success) {
    response.status(400).json({ error: "Invalid session id" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const session = professor ? await prisma.attendanceSession.findFirst({
      where: { id: parsedSessionId.data, professorId: professor.id },
      include: { course: { select: { id: true, courseCode: true, courseName: true } } }
    }) : null;
    if (!session?.course || !session.courseId) {
      response.status(404).json({ error: "Attendance session not found" });
      return;
    }

    const counters = await getAttendanceCounters(session.courseId, session.section, session.id);
    response.json({
      session: {
        session_id: session.id,
        course_id: session.course.id,
        course_code: session.course.courseCode,
        course_name: session.course.courseName,
        section: session.section,
        created_at: session.createdAt,
        expires_at: session.expiresAt,
        status: session.status,
        present_count: counters.presentCount,
        pending_count: counters.pendingCount,
        flagged_count: counters.flaggedCount
      }
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/sessions/:sessionId/flagged-attempts", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedSessionId = sessionIdParamSchema.safeParse(request.params.sessionId);
  if (!parsedSessionId.success) {
    response.status(400).json({ error: "Invalid session id" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const session = professor ? await prisma.attendanceSession.findFirst({
      where: { id: parsedSessionId.data, professorId: professor.id },
      select: { id: true, radius: true }
    }) : null;
    if (!session) {
      response.status(404).json({ error: "Attendance session not found" });
      return;
    }

    const attempts = await prisma.scanAttempt.findMany({
      where: {
        sessionId: session.id,
        result: "failed",
        reviewStatus: "pending",
        reasonCode: { notIn: nonReviewableFailureCodes }
      },
      include: { student: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" }
    });

    const consolidated = new Map<number, typeof attempts[number] & { attemptCount: number }>();
    for (const attempt of attempts) {
      const existing = consolidated.get(attempt.studentId);
      if (existing) {
        existing.attemptCount += 1;
      } else {
        consolidated.set(attempt.studentId, { ...attempt, attemptCount: 1 });
      }
    }

    response.json({
      attempts: [...consolidated.values()].flatMap((attempt) => attempt.student.user ? [{
        attempt_id: attempt.id,
        student_name: attempt.student.user.name,
        student_id: attempt.student.studentId,
        reason_code: attempt.reasonCode,
        failures: splitReasonCodes(attempt.reasonCode)
          .filter(isSoftFailureCode)
          .flatMap((code) => {
            const heading = professorFailureHeading(code, attempt.distanceMeters, session.radius ?? 40);
            return heading ? [{ code, heading }] : [];
          }),
        confidence_score: attempt.confidenceScore,
        timestamp: attempt.createdAt,
        attempt_count: attempt.attemptCount,
        review_status: attempt.reviewStatus
      }] : [])
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/sessions/:sessionId/pending-students", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedSessionId = sessionIdParamSchema.safeParse(request.params.sessionId);
  if (!parsedSessionId.success) {
    response.status(400).json({ error: "Invalid session id" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const session = professor ? await prisma.attendanceSession.findFirst({
      where: { id: parsedSessionId.data, professorId: professor.id },
      select: { id: true, courseId: true, section: true, status: true }
    }) : null;
    if (!professor || !session?.courseId) {
      response.status(404).json({ error: "Attendance session not found" });
      return;
    }

    const enrollments = await prisma.courseStudent.findMany({
      where: { courseId: session.courseId, section: session.section },
      include: { student: { include: { user: { select: { name: true } } } } },
      orderBy: { student: { studentId: "asc" } }
    });
    const [attendance, pendingFlaggedAttempts] = await Promise.all([
      prisma.attendance.findMany({ where: { sessionId: session.id }, select: { studentId: true } }),
      prisma.scanAttempt.findMany({
        where: {
          sessionId: session.id,
          result: "failed",
          reviewStatus: "pending",
          reasonCode: { notIn: nonReviewableFailureCodes }
        },
        distinct: ["studentId"],
        select: { studentId: true }
      })
    ]);
    // A reviewed/rejected technical failure no longer blocks the student from
    // Pending. They can retry while active or count absent after session end.
    const unavailableStudentIds = new Set([
      ...attendance.flatMap((row) => row.studentId === null ? [] : [row.studentId]),
      ...pendingFlaggedAttempts.map((attempt) => attempt.studentId)
    ]);

    response.json({
      session: { session_id: session.id, status: session.status },
      students: enrollments.flatMap((enrollment) =>
        enrollment.student?.user && enrollment.studentId !== null && !unavailableStudentIds.has(enrollment.studentId)
          ? [{ name: enrollment.student.user.name, student_id: enrollment.student.studentId }]
          : []
      )
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/sessions/:sessionId/present-students", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedSessionId = sessionIdParamSchema.safeParse(request.params.sessionId);
  if (!parsedSessionId.success) {
    response.status(400).json({ error: "Invalid session id" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const session = professor ? await prisma.attendanceSession.findFirst({
      where: { id: parsedSessionId.data, professorId: professor.id },
      select: { id: true, status: true }
    }) : null;
    if (!session) {
      response.status(404).json({ error: "Attendance session not found" });
      return;
    }

    const attendance = await prisma.attendance.findMany({
      where: { sessionId: session.id, status: "present" },
      include: { student: { include: { user: { select: { name: true } } } } },
      orderBy: { student: { studentId: "asc" } }
    });
    response.json({
      session: { session_id: session.id, status: session.status },
      students: attendance.flatMap((row) => row.student?.user ? [{
        name: row.student.user.name,
        student_id: row.student.studentId,
        manual_override: row.manualOverride
      }] : [])
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/sessions/:sessionId/students/:studentId/mark-absent", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedSessionId = sessionIdParamSchema.safeParse(request.params.sessionId);
  const parsedStudentId = universityStudentIdParamSchema.safeParse(request.params.studentId);
  if (!parsedSessionId.success || !parsedStudentId.success) {
    response.status(400).json({ error: "Invalid session or student ID" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const session = professor ? await prisma.attendanceSession.findFirst({
      where: { id: parsedSessionId.data, professorId: professor.id },
      select: { id: true, courseId: true, section: true, status: true }
    }) : null;
    if (!professor || !session?.courseId) {
      response.status(404).json({ error: "Attendance session not found" });
      return;
    }

    const student = await prisma.student.findUnique({ where: { studentId: parsedStudentId.data }, select: { id: true, studentId: true } });
    const enrollment = student ? await prisma.courseStudent.findFirst({
      where: { studentId: student.id, courseId: session.courseId, section: session.section },
      select: { id: true }
    }) : null;
    if (!student || !enrollment) {
      response.status(404).json({ error: "Student is not enrolled in this course-section" });
      return;
    }

    const attendance = await prisma.attendance.findUnique({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      select: { id: true }
    });
    if (!attendance) {
      response.status(404).json({ error: "Student is not marked present for this session" });
      return;
    }

    await prisma.$transaction([
      prisma.attendance.delete({ where: { id: attendance.id } }),
      prisma.scanAttempt.create({
        data: {
          sessionId: session.id,
          studentId: student.id,
          result: "manual_override",
          reasonCode: "MANUAL_MARK_ABSENT",
          reasonMessage: "Professor manually reverted confirmed attendance.",
          reviewStatus: "not_required",
          reviewedAt: new Date(),
          reviewedByProfessorId: professor.id
        }
      })
    ]);
    if (session.status === "active") {
      await broadcastAttendanceState(session.id);
    }
    const counters = await getAttendanceCounters(session.courseId, session.section, session.id);
    response.json({
      status: "pending",
      student_id: student.studentId,
      manual_override: true,
      counters: {
        present_count: counters.presentCount,
        pending_count: counters.pendingCount,
        flagged_count: counters.flaggedCount
      }
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/sessions/:sessionId/students/:studentId/mark-present", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedSessionId = sessionIdParamSchema.safeParse(request.params.sessionId);
  const parsedStudentId = universityStudentIdParamSchema.safeParse(request.params.studentId);
  if (!parsedSessionId.success || !parsedStudentId.success) {
    response.status(400).json({ error: "Invalid session or student ID" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const session = professor ? await prisma.attendanceSession.findFirst({
      where: { id: parsedSessionId.data, professorId: professor.id },
      select: { id: true, courseId: true, section: true, status: true }
    }) : null;
    if (!session?.courseId) {
      response.status(404).json({ error: "Attendance session not found" });
      return;
    }

    const student = await prisma.student.findUnique({ where: { studentId: parsedStudentId.data }, select: { id: true, studentId: true } });
    const enrollment = student ? await prisma.courseStudent.findFirst({
      where: { studentId: student.id, courseId: session.courseId, section: session.section },
      select: { id: true }
    }) : null;
    if (!student || !enrollment) {
      response.status(404).json({ error: "Student is not enrolled in this course-section" });
      return;
    }

    await prisma.attendance.create({
      data: { sessionId: session.id, studentId: student.id, status: "present", manualOverride: true }
    });
    if (session.status === "active") {
      await broadcastAttendanceState(session.id);
    }
    const counters = await getAttendanceCounters(session.courseId, session.section, session.id);
    response.status(201).json({
      status: "present",
      student_id: student.studentId,
      manual_override: true,
      counters: {
        present_count: counters.presentCount,
        pending_count: counters.pendingCount,
        flagged_count: counters.flaggedCount
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: "Student is already marked present for this session" });
      return;
    }
    next(error);
  }
});

attendanceRouter.post("/attempts/:attemptId/accept", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedAttemptId = attemptIdParamSchema.safeParse(request.params.attemptId);
  if (!parsedAttemptId.success) {
    response.status(400).json({ error: "Invalid attempt id" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const attempt = professor ? await prisma.scanAttempt.findFirst({
      where: {
        id: parsedAttemptId.data,
        result: "failed",
        reviewStatus: "pending",
        reasonCode: { notIn: nonReviewableFailureCodes },
        session: { professorId: professor.id }
      },
      include: { student: { select: { studentId: true } } }
    }) : null;
    if (!professor || !attempt?.sessionId) {
      response.status(404).json({ error: "Pending flagged attempt not found" });
      return;
    }

    const existingAttendance = await prisma.attendance.findFirst({
      where: { sessionId: attempt.sessionId, studentId: attempt.studentId }
    });
    if (existingAttendance) {
      await prisma.scanAttempt.updateMany({
        where: {
          sessionId: attempt.sessionId,
          studentId: attempt.studentId,
          result: "failed",
          reviewStatus: "pending",
          reasonCode: { notIn: nonReviewableFailureCodes }
        },
        data: { reviewStatus: "accepted", reviewedAt: new Date(), reviewedByProfessorId: professor.id }
      });
      await broadcastAttendanceState(attempt.sessionId);
      response.json({
        status: "accepted",
        student_id: attempt.student.studentId,
        attendance_already_present: true,
        manual_override: existingAttendance.manualOverride
      });
      return;
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.scanAttempt.updateMany({
        where: {
          sessionId: attempt.sessionId,
          studentId: attempt.studentId,
          result: "failed",
          reviewStatus: "pending",
          reasonCode: { notIn: nonReviewableFailureCodes }
        },
        data: { reviewStatus: "accepted", reviewedAt: new Date(), reviewedByProfessorId: professor.id }
      });
      await transaction.attendance.create({
        data: { sessionId: attempt.sessionId, studentId: attempt.studentId, status: "present", manualOverride: true }
      });
    });

    await broadcastAttendanceState(attempt.sessionId);
    response.json({ status: "accepted", student_id: attempt.student.studentId, manual_override: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: "Student is already marked present for this session" });
      return;
    }
    next(error);
  }
});

attendanceRouter.post("/attempts/:attemptId/reject", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedAttemptId = attemptIdParamSchema.safeParse(request.params.attemptId);
  if (!parsedAttemptId.success) {
    response.status(400).json({ error: "Invalid attempt id" });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const attempt = professor ? await prisma.scanAttempt.findFirst({
      where: {
        id: parsedAttemptId.data,
        result: "failed",
        reviewStatus: "pending",
        reasonCode: { notIn: nonReviewableFailureCodes },
        session: { professorId: professor.id }
      },
      include: { student: { select: { studentId: true } } }
    }) : null;
    if (!professor || !attempt?.sessionId) {
      response.status(404).json({ error: "Pending flagged attempt not found" });
      return;
    }

    await prisma.scanAttempt.updateMany({
      where: {
        sessionId: attempt.sessionId,
        studentId: attempt.studentId,
        result: "failed",
        reviewStatus: "pending",
        reasonCode: { notIn: nonReviewableFailureCodes }
      },
      data: { reviewStatus: "rejected", reviewedAt: new Date(), reviewedByProfessorId: professor.id }
    });
    await broadcastAttendanceState(attempt.sessionId);
    response.json({ status: "rejected", student_id: attempt.student.studentId });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/start", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsed = startSessionSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid session data", details: parsed.error.flatten() });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id } });

    if (!professor) {
      response.status(403).json({ error: "Professor profile not found" });
      return;
    }

    const teachingAssignment = await prisma.courseProfessor.findUnique({
      where: {
        courseId_professorId_section: {
          courseId: parsed.data.course_id,
          professorId: professor.id,
          section: parsed.data.section
        }
      }
    });

    if (!teachingAssignment) {
      response.status(403).json({ error: "You are not assigned to this course section" });
      return;
    }

    const sectionEnrollment = await prisma.courseStudent.findFirst({
      where: { courseId: parsed.data.course_id, section: parsed.data.section },
      select: { id: true }
    });

    if (!sectionEnrollment) {
      response.status(400).json({ error: "This course section has no enrolled students" });
      return;
    }

    const expiresAt = parsed.data.expires_at
      ? new Date(parsed.data.expires_at)
      : new Date(Date.now() + 10 * 60 * 1000);
    const session = await prisma.attendanceSession.create({
      data: {
        courseId: parsed.data.course_id,
        professorId: professor.id,
        section: parsed.data.section,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        radius: parsed.data.radius,
        status: "active",
        expiresAt
      }
    });
    startSessionRealtime(session.id);

    response.status(201).json({
      session: {
        id: session.id,
        course_id: session.courseId,
        section: session.section,
        latitude: session.latitude,
        longitude: session.longitude,
        radius: session.radius,
        status: session.status,
        created_at: session.createdAt,
        expires_at: session.expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/end", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsed = endSessionSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid session data", details: parsed.error.flatten() });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id } });
    if (!professor) {
      response.status(403).json({ error: "Professor profile not found" });
      return;
    }

    const session = await prisma.attendanceSession.findFirst({
      where: { id: parsed.data.session_id, professorId: professor.id, status: "active" }
    });
    if (!session) {
      response.status(404).json({ error: "Active session not found" });
      return;
    }

    const endedSession = await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { status: "ended", qrToken: null, previousQrToken: null, previousQrTokenRotatedAt: null }
    });
    endSessionRealtime(session.id);

    response.json({ session: { session_id: endedSession.id, status: endedSession.status, ended_at: new Date() } });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/reports", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedQuery = reportsQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({ error: "Invalid reports filter", details: parsedQuery.error.flatten() });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id } });

    if (!professor) {
      response.status(403).json({ error: "Professor profile not found" });
      return;
    }

    const assignments = await prisma.courseProfessor.findMany({
      where: { professorId: professor.id },
      include: { course: { select: { id: true, courseCode: true, courseName: true } } },
      orderBy: [{ courseId: "asc" }, { section: "asc" }]
    });
    const selectedAssignment = parsedQuery.data.course_id
      ? assignments.find((assignment) =>
          assignment.courseId === parsedQuery.data.course_id && assignment.section === parsedQuery.data.section
        )
      : null;
    if (parsedQuery.data.course_id && !selectedAssignment) {
      response.status(403).json({ error: "You are not assigned to this course-section" });
      return;
    }

    const sections = await Promise.all(assignments.map(async (assignment) => {
      if (!assignment.courseId || !assignment.course) {
        return null;
      }

      const enrollments = await prisma.courseStudent.findMany({
        where: { courseId: assignment.courseId, section: assignment.section },
        include: { student: { include: { user: { select: { name: true } } } } }
      });
      const sessions = await prisma.attendanceSession.findMany({
        where: { courseId: assignment.courseId, section: assignment.section, status: "ended" },
        select: { id: true }
      });

      return {
        course_id: assignment.course.id,
        course_code: assignment.course.courseCode,
        course_name: assignment.course.courseName,
        section: assignment.section,
        defaulters: await Promise.all(enrollments.flatMap(async (enrollment) => {
          if (!enrollment.student?.user || !enrollment.studentId) {
            return [];
          }

          const presentSessions = await prisma.attendance.count({
            where: {
              studentId: enrollment.studentId,
              sessionId: { in: sessions.map((session) => session.id) },
              status: "present"
            }
          });
          const warning = calculateAttendanceWarning(sessions.length, presentSessions);
          if (warning.status !== "warning" && warning.status !== "critical") {
            return [];
          }

          return [{
            name: enrollment.student.user.name,
            student_id: enrollment.student.studentId,
            absence_count: warning.absenceCount,
            attendance_percentage: warning.attendancePercentage,
            status: warning.status
          }];
        })).then((rows) => rows.flat())
      };
    }));

    const recentSessions = await prisma.attendanceSession.findMany({
      where: {
        professorId: professor.id,
        status: "ended",
        ...(selectedAssignment ? {
          courseId: selectedAssignment.courseId,
          section: selectedAssignment.section
        } : {}),
        ...(parsedQuery.data.date_from || parsedQuery.data.date_to ? {
          createdAt: {
            gte: localDateBoundary(
              parsedQuery.data.date_from ?? parsedQuery.data.date_to!,
              parsedQuery.data.timezone_offset_minutes,
              false
            ),
            lte: localDateBoundary(
              parsedQuery.data.date_to ?? parsedQuery.data.date_from!,
              parsedQuery.data.timezone_offset_minutes,
              true
            )
          }
        } : {})
      },
      include: { course: { select: { courseCode: true, courseName: true } } },
      orderBy: { createdAt: parsedQuery.data.sort === "oldest" ? "asc" : "desc" },
      skip: parsedQuery.data.offset,
      take: parsedQuery.data.limit + 1
    });
    const hasMore = recentSessions.length > parsedQuery.data.limit;
    const sessionPage = recentSessions.slice(0, parsedQuery.data.limit);

    response.json({
      sections: sections.filter((section) => section !== null),
      recent_sessions: sessionPage.flatMap((session) => session.course ? [{
        session_id: session.id,
        course_code: session.course.courseCode,
        course_name: session.course.courseName,
        section: session.section,
        ended_at: session.createdAt
      }] : []),
      pagination: {
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        has_more: hasMore
      }
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/reports/analytics", requireAuth, requireRole("professor"), async (request, response, next) => {
  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    if (!professor) {
      response.status(403).json({ error: "Professor profile not found" });
      return;
    }

    const assignments = await prisma.courseProfessor.findMany({
      where: { professorId: professor.id },
      include: { course: { select: { id: true, courseCode: true, courseName: true } } },
      orderBy: [{ courseId: "asc" }, { section: "asc" }]
    });
    const sectionBuilders = assignments.flatMap((assignment) => {
      const courseId = assignment.courseId;
      const course = assignment.course;
      return courseId && course ? [async () => {
        const [sessions, enrollments] = await Promise.all([
          prisma.attendanceSession.findMany({
            where: { courseId, section: assignment.section, status: "ended" },
            select: { id: true }
          }),
          prisma.courseStudent.findMany({
            where: { courseId, section: assignment.section },
            select: { studentId: true }
          })
        ]);
        const sessionIds = sessions.map((session) => session.id);
        const attendance = sessionIds.length ? await prisma.attendance.findMany({
          where: { sessionId: { in: sessionIds }, status: "present" },
          select: { studentId: true }
        }) : [];
        const presentByStudent = new Map<number, number>();
        for (const row of attendance) {
          if (row.studentId !== null) {
            presentByStudent.set(row.studentId, (presentByStudent.get(row.studentId) ?? 0) + 1);
          }
        }
        const tierCounts = { excellent: 0, safe: 0, warning: 0, critical: 0 };
        for (const enrollment of enrollments) {
          if (enrollment.studentId !== null) {
            const warning = calculateAttendanceWarning(sessions.length, presentByStudent.get(enrollment.studentId) ?? 0);
            tierCounts[warning.status] += 1;
          }
        }
        const attendanceOpportunities = sessions.length * enrollments.length;

        return {
          course_id: course.id,
          course_code: course.courseCode,
          course_name: course.courseName,
          section: assignment.section,
          attendance_rate: attendanceOpportunities === 0 ? 0 : Math.round((attendance.length / attendanceOpportunities) * 100),
          total_sessions: sessions.length,
          enrolled_students: enrollments.length,
          tiers: tierCounts
        };
      }] : [];
    });
    const sections = await Promise.all(sectionBuilders.map((buildSection) => buildSection()));

    response.json({ sections });
  } catch (error) {
    next(error);
  }
});

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

attendanceRouter.get("/reports/export", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsedQuery = exportQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({ error: "Invalid export filter", details: parsedQuery.error.flatten() });
    return;
  }

  try {
    const professor = await prisma.professor.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    if (!professor) {
      response.status(403).json({ error: "Professor profile not found" });
      return;
    }

    const assignments = await prisma.courseProfessor.findMany({
      where: {
        professorId: professor.id,
        ...(parsedQuery.data.course_id ? {
          courseId: parsedQuery.data.course_id,
          section: parsedQuery.data.section
        } : {})
      },
      include: { course: { select: { id: true, courseCode: true, courseName: true } } },
      orderBy: [{ courseId: "asc" }, { section: "asc" }]
    });
    if (parsedQuery.data.course_id && assignments.length === 0) {
      response.status(403).json({ error: "You are not assigned to this course-section" });
      return;
    }

    const rows: Array<Array<string | number>> = [[
      "Course Code", "Course Name", "Section", "Session Date", "Student Name", "Student ID", "Status"
    ]];
    for (const assignment of assignments) {
      if (!assignment.courseId || !assignment.course) continue;
      const [sessions, enrollments] = await Promise.all([
        prisma.attendanceSession.findMany({
          where: { courseId: assignment.courseId, section: assignment.section, status: "ended" },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "asc" }
        }),
        prisma.courseStudent.findMany({
          where: { courseId: assignment.courseId, section: assignment.section },
          include: { student: { include: { user: { select: { name: true } } } } },
          orderBy: { student: { studentId: "asc" } }
        })
      ]);
      const attendance = sessions.length ? await prisma.attendance.findMany({
        where: { sessionId: { in: sessions.map((session) => session.id) }, status: "present" },
        select: { sessionId: true, studentId: true }
      }) : [];
      const presentKeys = new Set(attendance.map((row) => `${row.sessionId}:${row.studentId}`));

      for (const session of sessions) {
        for (const enrollment of enrollments) {
          if (!enrollment.student?.user || enrollment.studentId === null) continue;
          rows.push([
            assignment.course.courseCode,
            assignment.course.courseName,
            assignment.section,
            session.createdAt?.toISOString() ?? "",
            enrollment.student.user.name,
            enrollment.student.studentId,
            presentKeys.has(`${session.id}:${enrollment.studentId}`) ? "present" : "absent"
          ]);
        }
      }
    }

    const suffix = parsedQuery.data.course_id
      ? `${assignments[0]?.course?.courseCode ?? "section"}-${parsedQuery.data.section}`
      : "all-sections";
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="yupresence-${suffix}.csv"`);
    response.send(`\uFEFF${csv}`);
  } catch (error) {
    next(error);
  }
});

export { attendanceRouter };
