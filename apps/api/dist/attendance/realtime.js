import jwt from "jsonwebtoken";
import { getJwtSecret } from "../auth/jwt.js";
import { prisma } from "../prisma/client.js";
const rotationIntervalMs = 10_000;
const tokenLifetimeSeconds = 20;
const roomName = (sessionId) => `attendance:${sessionId}`;
let socketServer = null;
const sessionTimers = new Map();
export async function getAttendanceCounters(courseId, section, sessionId) {
    const [enrolledCount, presentCount, flaggedCount] = await Promise.all([
        prisma.courseStudent.count({ where: { courseId, section } }),
        prisma.attendance.count({ where: { sessionId, status: "present" } }),
        prisma.scanAttempt.count({ where: { sessionId, result: "failed", reviewStatus: "pending" } })
    ]);
    return {
        presentCount,
        pendingCount: Math.max(enrolledCount - presentCount, 0),
        flaggedCount
    };
}
function isProfessorToken(payload) {
    return typeof payload !== "string" && payload.role === "professor" && Number.isInteger(payload.user_id);
}
function qrPayload(session) {
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
async function getActiveSession(sessionId) {
    return prisma.attendanceSession.findFirst({
        where: { id: sessionId, status: "active" },
        select: { id: true, courseId: true, professorId: true, section: true, qrToken: true, expiresAt: true }
    });
}
async function emitSessionState(sessionId, target) {
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
    }
    else {
        socketServer?.to(roomName(sessionId)).emit("attendance:update", payload);
    }
}
export function broadcastAttendanceState(sessionId) {
    return emitSessionState(sessionId);
}
async function rotateQrToken(sessionId) {
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
    await prisma.attendanceSession.update({ where: { id: session.id }, data: { qrToken: token } });
    await emitSessionState(session.id);
}
async function expireSession(sessionId) {
    stopSessionRealtime(sessionId);
    await prisma.attendanceSession.updateMany({
        where: { id: sessionId, status: "active" },
        data: { status: "ended", qrToken: null }
    });
    socketServer?.to(roomName(sessionId)).emit("attendance:ended", { session_id: sessionId });
}
export function configureAttendanceRealtime(io) {
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
            socket.data = { userId: payload.user_id, role: payload.role };
            next();
        }
        catch {
            next(new Error("Invalid or expired authentication token"));
        }
    });
    io.on("connection", (socket) => {
        socket.on("attendance:join", async (value) => {
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
export function startSessionRealtime(sessionId) {
    stopSessionRealtime(sessionId);
    void rotateQrToken(sessionId);
    const rotation = setInterval(() => void rotateQrToken(sessionId), rotationIntervalMs);
    const status = setInterval(() => void emitSessionState(sessionId), 1_000);
    sessionTimers.set(sessionId, { rotation, status });
}
export function stopSessionRealtime(sessionId) {
    const timers = sessionTimers.get(sessionId);
    if (timers) {
        clearInterval(timers.rotation);
        clearInterval(timers.status);
        sessionTimers.delete(sessionId);
    }
}
export function endSessionRealtime(sessionId) {
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
