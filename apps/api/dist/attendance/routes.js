import { Router } from "express";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { getJwtSecret } from "../auth/jwt.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { calculateAttendanceWarning } from "./warnings.js";
import { broadcastAttendanceState, endSessionRealtime, getAttendanceCounters, startSessionRealtime } from "./realtime.js";
import { prisma } from "../prisma/client.js";
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
function isScanTokenClaims(payload) {
    return typeof payload !== "string" &&
        Number.isInteger(payload.session_id) &&
        Number.isInteger(payload.course_id) &&
        typeof payload.section === "string" &&
        Number.isInteger(payload.issued_at);
}
function haversineDistanceMeters(firstLatitude, firstLongitude, secondLatitude, secondLongitude) {
    const earthRadiusMeters = 6_371_000;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const latitudeDelta = toRadians(secondLatitude - firstLatitude);
    const longitudeDelta = toRadians(secondLongitude - firstLongitude);
    const a = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(toRadians(firstLatitude)) * Math.cos(toRadians(secondLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const attemptReasonLabels = {
    SCAN_INVALID: "Invalid scan data",
    TOKEN_INVALID: "Invalid QR token",
    TOKEN_STALE: "Expired QR code",
    DEVICE_NOT_REGISTERED: "Device not registered",
    DEVICE_MISMATCH: "Device mismatch",
    NOT_ENROLLED: "Not enrolled",
    SECTION_MISMATCH: "Section mismatch",
    OUTSIDE_GEOFENCE: "Out of range",
    DUPLICATE_ATTENDANCE: "Duplicate attendance"
};
attendanceRouter.get("/assignments", requireAuth, requireRole("professor"), async (request, response, next) => {
    try {
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id } });
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
    }
    catch (error) {
        next(error);
    }
});
attendanceRouter.get("/active", requireAuth, requireRole("professor"), async (request, response, next) => {
    try {
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id } });
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
    }
    catch (error) {
        next(error);
    }
});
attendanceRouter.post("/scan", requireAuth, requireRole("student"), async (request, response, next) => {
    try {
        const student = await prisma.student.findUnique({ where: { userId: request.user.user_id } });
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
        const rejectAttempt = async (httpStatus, code, message, sessionId = null, distanceMeters = null) => {
            await prisma.scanAttempt.create({
                data: {
                    sessionId,
                    studentId: student.id,
                    result: "failed",
                    reasonCode: code,
                    reasonMessage: message,
                    reviewStatus: "pending",
                    distanceMeters,
                    ...inputMetadata
                }
            });
            if (sessionId) {
                await broadcastAttendanceState(sessionId);
            }
            response.status(httpStatus).json({ code, error: message });
        };
        if (!parsed.success) {
            await rejectAttempt(400, "SCAN_INVALID", "Scan request is missing valid QR, location, or device data.");
            return;
        }
        let qrEnvelope;
        let tokenClaims;
        let rawToken;
        try {
            qrEnvelope = JSON.parse(parsed.data.qr_payload);
            if (typeof qrEnvelope.token !== "string") {
                throw new Error("QR token is missing");
            }
            rawToken = qrEnvelope.token;
            const verified = jwt.verify(rawToken, getJwtSecret());
            if (!isScanTokenClaims(verified) ||
                qrEnvelope.session_id !== verified.session_id ||
                qrEnvelope.course_id !== verified.course_id ||
                qrEnvelope.section !== verified.section) {
                throw new Error("QR token claims do not match its envelope");
            }
            tokenClaims = verified;
        }
        catch {
            await rejectAttempt(401, "TOKEN_INVALID", "This QR token is invalid, malformed, or expired.");
            return;
        }
        // 2. The token must still be the exact token currently stored for this active session.
        const session = await prisma.attendanceSession.findUnique({ where: { id: tokenClaims.session_id } });
        if (!session || session.status !== "active" || session.qrToken !== rawToken ||
            session.courseId !== tokenClaims.course_id || session.section !== tokenClaims.section) {
            await rejectAttempt(409, "TOKEN_STALE", "This QR token is no longer current. Scan the latest code.", session?.id ?? null);
            return;
        }
        // 3. The scan must originate from the student's registered device.
        if (!student.deviceId) {
            await rejectAttempt(403, "DEVICE_NOT_REGISTERED", "This device is not registered for your account.", session.id);
            return;
        }
        if (student.deviceId !== parsed.data.device_id) {
            await rejectAttempt(403, "DEVICE_MISMATCH", "This scan came from a device that does not match your registered device.", session.id);
            return;
        }
        // 4. Enrollment is checked first by course, then by the exact section for a distinct demo message.
        const courseEnrollment = await prisma.courseStudent.findFirst({
            where: { studentId: student.id, courseId: tokenClaims.course_id },
            select: { section: true }
        });
        if (!courseEnrollment) {
            await rejectAttempt(403, "NOT_ENROLLED", "You are not enrolled in this course.", session.id);
            return;
        }
        if (courseEnrollment.section !== tokenClaims.section) {
            await rejectAttempt(403, "SECTION_MISMATCH", `Section mismatch: you are enrolled in section ${courseEnrollment.section}, but this session is for section ${tokenClaims.section}.`, session.id);
            return;
        }
        // 5. GPS position must fall within the professor-configured session radius.
        const distanceMeters = haversineDistanceMeters(parsed.data.latitude, parsed.data.longitude, session.latitude, session.longitude);
        if (distanceMeters > (session.radius ?? 40)) {
            await rejectAttempt(403, "OUTSIDE_GEOFENCE", `You are outside the attendance area (${Math.round(distanceMeters)}m away; radius is ${session.radius ?? 40}m).`, session.id, distanceMeters);
            return;
        }
        // 6. No student can receive more than one mark per session.
        const duplicate = await prisma.attendance.findFirst({ where: { sessionId: session.id, studentId: student.id }, select: { id: true } });
        if (duplicate) {
            await rejectAttempt(409, "DUPLICATE_ATTENDANCE", "You are already marked present for this session.", session.id, distanceMeters);
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
            });
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                await rejectAttempt(409, "DUPLICATE_ATTENDANCE", "You are already marked present for this session.", session.id, distanceMeters);
                return;
            }
            throw error;
        }
        await broadcastAttendanceState(session.id);
        response.status(201).json({
            status: "present",
            session: { course_id: tokenClaims.course_id, section: tokenClaims.section },
            distance_meters: Math.round(distanceMeters)
        });
    }
    catch (error) {
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
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id }, select: { id: true } });
        const session = professor ? await prisma.attendanceSession.findFirst({
            where: { id: parsedSessionId.data, professorId: professor.id },
            select: { id: true }
        }) : null;
        if (!session) {
            response.status(404).json({ error: "Attendance session not found" });
            return;
        }
        const attempts = await prisma.scanAttempt.findMany({
            where: { sessionId: session.id, result: "failed", reviewStatus: "pending" },
            include: { student: { include: { user: { select: { name: true } } } } },
            orderBy: { createdAt: "desc" }
        });
        response.json({
            attempts: attempts.flatMap((attempt) => attempt.student.user ? [{
                    attempt_id: attempt.id,
                    student_name: attempt.student.user.name,
                    student_id: attempt.student.studentId,
                    reason_code: attempt.reasonCode,
                    reason: attemptReasonLabels[attempt.reasonCode ?? ""] ?? "Rejected scan",
                    details: attempt.reasonMessage,
                    timestamp: attempt.createdAt,
                    review_status: attempt.reviewStatus
                }] : [])
        });
    }
    catch (error) {
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
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id }, select: { id: true } });
        const attempt = professor ? await prisma.scanAttempt.findFirst({
            where: { id: parsedAttemptId.data, result: "failed", reviewStatus: "pending", session: { professorId: professor.id } },
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
            await prisma.scanAttempt.update({
                where: { id: attempt.id },
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
            await transaction.scanAttempt.update({
                where: { id: attempt.id },
                data: { reviewStatus: "accepted", reviewedAt: new Date(), reviewedByProfessorId: professor.id }
            });
            await transaction.attendance.create({
                data: { sessionId: attempt.sessionId, studentId: attempt.studentId, status: "present", manualOverride: true }
            });
        });
        await broadcastAttendanceState(attempt.sessionId);
        response.json({ status: "accepted", student_id: attempt.student.studentId, manual_override: true });
    }
    catch (error) {
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
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id }, select: { id: true } });
        const attempt = professor ? await prisma.scanAttempt.findFirst({
            where: { id: parsedAttemptId.data, result: "failed", reviewStatus: "pending", session: { professorId: professor.id } },
            include: { student: { select: { studentId: true } } }
        }) : null;
        if (!professor || !attempt?.sessionId) {
            response.status(404).json({ error: "Pending flagged attempt not found" });
            return;
        }
        await prisma.scanAttempt.update({
            where: { id: attempt.id },
            data: { reviewStatus: "rejected", reviewedAt: new Date(), reviewedByProfessorId: professor.id }
        });
        await broadcastAttendanceState(attempt.sessionId);
        response.json({ status: "rejected", student_id: attempt.student.studentId });
    }
    catch (error) {
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
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id } });
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
            : new Date(Date.now() + 90 * 60 * 1000);
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
    }
    catch (error) {
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
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id } });
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
            data: { status: "ended", qrToken: null }
        });
        endSessionRealtime(session.id);
        response.json({ session: { session_id: endedSession.id, status: endedSession.status, ended_at: new Date() } });
    }
    catch (error) {
        next(error);
    }
});
attendanceRouter.get("/reports", requireAuth, requireRole("professor"), async (request, response, next) => {
    try {
        const professor = await prisma.professor.findUnique({ where: { userId: request.user.user_id } });
        if (!professor) {
            response.status(403).json({ error: "Professor profile not found" });
            return;
        }
        const assignments = await prisma.courseProfessor.findMany({
            where: { professorId: professor.id },
            include: { course: { select: { id: true, courseCode: true, courseName: true } } },
            orderBy: [{ courseId: "asc" }, { section: "asc" }]
        });
        const sections = await Promise.all(assignments.map(async (assignment) => {
            if (!assignment.courseId || !assignment.course) {
                return null;
            }
            const enrollments = await prisma.courseStudent.findMany({
                where: { courseId: assignment.courseId, section: assignment.section },
                include: { student: { include: { user: { select: { name: true } } } } }
            });
            const sessions = await prisma.attendanceSession.findMany({
                where: { courseId: assignment.courseId, section: assignment.section },
                select: { id: true }
            });
            return {
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
                    if (warning.status !== "critical") {
                        return [];
                    }
                    return [{
                            name: enrollment.student.user.name,
                            student_id: enrollment.student.studentId,
                            absence_count: warning.absenceCount,
                            attendance_percentage: warning.attendancePercentage,
                            status: "critical"
                        }];
                })).then((rows) => rows.flat())
            };
        }));
        response.json({ sections: sections.filter((section) => section !== null) });
    }
    catch (error) {
        next(error);
    }
});
export { attendanceRouter };
