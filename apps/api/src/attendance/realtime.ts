import jwt, { type JwtPayload } from "jsonwebtoken";
import type { Server, Socket } from "socket.io";

import { getJwtSecret } from "../auth/jwt.js";
import { prisma } from "../prisma/client.js";
import { nonReviewableFailureCodes } from "./review-policy.js";

const rotationIntervalMs = 10_000;
const tokenLifetimeSeconds = 20;
export const previousQrTokenGracePeriodMs = 3_000;
const roomName = (sessionId: number) => `attendance:${sessionId}`;

interface SessionTimers {
  rotation: ReturnType<typeof setInterval>;
  status: ReturnType<typeof setInterval>;
}

interface ProfessorSocketData {
  userId: number;
  role: "professor";
}

let socketServer: Server | null = null;
const sessionTimers = new Map<number, SessionTimers>();

export interface AttendanceCounters {
  presentCount: number;
  pendingCount: number;
  flaggedCount: number;
}

export async function getAttendanceCounters(courseId: number, section: string, sessionId: number): Promise<AttendanceCounters> {
  const [enrolledStudents, presentRows, pendingFlaggedStudents] = await Promise.all([
    prisma.courseStudent.findMany({ where: { courseId, section }, select: { studentId: true } }),
    prisma.attendance.findMany({ where: { sessionId, status: "present" }, select: { studentId: true } }),
    prisma.scanAttempt.findMany({
      where: {
        sessionId,
        result: "failed",
        reviewStatus: "pending",
        reasonCode: { notIn: nonReviewableFailureCodes }
      },
      distinct: ["studentId"],
      select: { studentId: true }
    })
  ]);
  // A rejected/reviewed failure returns the enrolled student to Pending.
  // Only an unresolved, reviewable failure temporarily removes them from it.
  const pendingFlaggedStudentIds = new Set(pendingFlaggedStudents.map((attempt) => attempt.studentId));
  const presentStudentIds = new Set(presentRows.flatMap((row) => row.studentId === null ? [] : [row.studentId]));
  const pendingCount = enrolledStudents.filter((enrollment) =>
    enrollment.studentId !== null &&
    !presentStudentIds.has(enrollment.studentId) &&
    !pendingFlaggedStudentIds.has(enrollment.studentId)
  ).length;

  return {
    presentCount: presentRows.length,
    pendingCount,
    flaggedCount: pendingFlaggedStudents.length
  };
}

function isProfessorToken(payload: string | JwtPayload): payload is JwtPayload & { user_id: number; role: "professor" } {
  return typeof payload !== "string" && payload.role === "professor" && Number.isInteger(payload.user_id);
}

function qrPayload(session: { id: number; courseId: number | null; section: string; qrToken: string | null }) {
  if (!session.courseId || !session.qrToken) {
    return null;
  }

  const decoded = jwt.decode(session.qrToken);
  const issuedAt = typeof decoded !== "string" && typeof decoded?.issued_at === "number"
    ? decoded.issued_at
    : Math.floor(Date.now() / 1000);

  return JSON.stringify({
    session_id: session.id,
    token: session.qrToken,
    course_id: session.courseId,
    section: session.section,
    issued_at: issuedAt
  });
}

async function getActiveSession(sessionId: number) {
  return prisma.attendanceSession.findFirst({
    where: { id: sessionId, status: "active" },
    select: { id: true, courseId: true, professorId: true, section: true, qrToken: true, expiresAt: true }
  });
}

async function emitSessionState(sessionId: number, target?: Socket) {
  const session = await getActiveSession(sessionId);
  if (!session || !session.expiresAt || session.expiresAt.getTime() <= Date.now()) {
    await expireSession(sessionId);
    return;
  }

  const counters = session.courseId
    ? await getAttendanceCounters(session.courseId, session.section, session.id)
    : { presentCount: 0, pendingCount: 0, flaggedCount: 0 };

  const payload = {
    session_id: session.id,
    qr_payload: qrPayload(session),
    present_count: counters.presentCount,
    pending_count: counters.pendingCount,
    flagged_count: counters.flaggedCount,
    remaining_seconds: Math.max(0, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000))
  };

  if (target) {
    target.emit("attendance:update", payload);
  } else {
    socketServer?.to(roomName(sessionId)).emit("attendance:update", payload);
  }
}

export function broadcastAttendanceState(sessionId: number) {
  return emitSessionState(sessionId);
}

async function rotateQrToken(sessionId: number) {
  const session = await getActiveSession(sessionId);
  if (!session || !session.courseId || !session.expiresAt || session.expiresAt.getTime() <= Date.now()) {
    await expireSession(sessionId);
    return;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const token = jwt.sign({
    session_id: session.id,
    course_id: session.courseId,
    section: session.section,
    issued_at: issuedAt
  }, getJwtSecret(), { expiresIn: tokenLifetimeSeconds });

  const updated = await prisma.attendanceSession.updateMany({
    where: { id: session.id, status: "active" },
    data: {
      previousQrToken: session.qrToken,
      previousQrTokenRotatedAt: session.qrToken ? new Date() : null,
      qrToken: token
    }
  });
  if (updated.count === 0) {
    stopSessionRealtime(session.id);
    return;
  }
  await emitSessionState(session.id);
}

async function expireSession(sessionId: number) {
  stopSessionRealtime(sessionId);
  await prisma.attendanceSession.updateMany({
    where: { id: sessionId, status: "active" },
    data: { status: "ended", qrToken: null, previousQrToken: null, previousQrTokenRotatedAt: null }
  });
  socketServer?.to(roomName(sessionId)).emit("attendance:ended", { session_id: sessionId });
}

export function configureAttendanceRealtime(io: Server) {
  socketServer = io;

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== "string") {
        next(new Error("Authentication required"));
        return;
      }

      const payload = jwt.verify(token, getJwtSecret());
      if (!isProfessorToken(payload)) {
        next(new Error("Professor authentication required"));
        return;
      }

      socket.data = { userId: payload.user_id, role: payload.role } satisfies ProfessorSocketData;
      next();
    } catch {
      next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("attendance:join", async (value: unknown) => {
      const sessionId = typeof value === "object" && value !== null && "session_id" in value
        ? Number(value.session_id)
        : NaN;
      if (!Number.isInteger(sessionId) || sessionId <= 0) {
        socket.emit("attendance:error", { error: "Invalid session" });
        return;
      }

      const professor = await prisma.professor.findUnique({ where: { userId: socket.data.userId }, select: { id: true } });
      const session = professor ? await prisma.attendanceSession.findFirst({
        where: { id: sessionId, professorId: professor.id, status: "active" },
        select: { id: true }
      }) : null;
      if (!session) {
        socket.emit("attendance:error", { error: "Active session not found" });
        return;
      }

      await socket.join(roomName(sessionId));
      await emitSessionState(sessionId, socket);
    });
  });
}

export function startSessionRealtime(sessionId: number) {
  stopSessionRealtime(sessionId);
  void rotateQrToken(sessionId);
  const rotation = setInterval(() => void rotateQrToken(sessionId), rotationIntervalMs);
  const status = setInterval(() => void emitSessionState(sessionId), 1_000);
  sessionTimers.set(sessionId, { rotation, status });
}

export function stopSessionRealtime(sessionId: number) {
  const timers = sessionTimers.get(sessionId);
  if (timers) {
    clearInterval(timers.rotation);
    clearInterval(timers.status);
    sessionTimers.delete(sessionId);
  }
}

export function endSessionRealtime(sessionId: number) {
  stopSessionRealtime(sessionId);
  socketServer?.to(roomName(sessionId)).emit("attendance:ended", { session_id: sessionId });
}

export async function resumeActiveSessionsRealtime() {
  const sessions = await prisma.attendanceSession.findMany({
    where: { status: "active" },
    select: { id: true }
  });
  sessions.forEach((session) => startSessionRealtime(session.id));
}
