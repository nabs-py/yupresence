import bcrypt from "bcrypt";
import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { calculateAttendanceWarning } from "../attendance/warnings.js";
import { prisma } from "../prisma/client.js";
import { changePasswordSchema, registerDeviceSchema } from "./validation.js";
const studentsRouter = Router();
studentsRouter.get("/profile", requireAuth, requireRole("student"), async (request, response, next) => {
    try {
        const student = await prisma.student.findUnique({
            where: { userId: request.user.user_id },
            include: { user: { select: { name: true, email: true, role: true } } }
        });
        if (!student?.user) {
            response.status(404).json({ error: "Student profile not found" });
            return;
        }
        response.json({
            name: student.user.name,
            email: student.user.email,
            role: student.user.role,
            student_id: student.studentId,
            department: student.department,
            semester: student.semester
        });
    }
    catch (error) {
        next(error);
    }
});
studentsRouter.get("/attendance", requireAuth, requireRole("student"), async (request, response, next) => {
    try {
        const student = await prisma.student.findUnique({ where: { userId: request.user.user_id }, select: { id: true } });
        if (!student) {
            response.status(404).json({ error: "Student profile not found" });
            return;
        }
        const enrollments = await prisma.courseStudent.findMany({
            where: { studentId: student.id },
            include: { course: { select: { id: true, courseCode: true, courseName: true } } }
        });
        const sectionPairs = enrollments.flatMap((enrollment) => enrollment.courseId === null || enrollment.course === null
            ? []
            : [{ courseId: enrollment.courseId, section: enrollment.section }]);
        const sessions = sectionPairs.length
            ? await prisma.attendanceSession.findMany({
                where: { OR: sectionPairs },
                orderBy: { createdAt: "asc" },
                select: { id: true, courseId: true, section: true, createdAt: true }
            })
            : [];
        const attendance = sessions.length
            ? await prisma.attendance.findMany({
                where: { studentId: student.id, sessionId: { in: sessions.map((session) => session.id) }, status: "present" },
                select: { sessionId: true, timestamp: true }
            })
            : [];
        const presentSessionIds = new Set(attendance.map((row) => row.sessionId));
        const courseBreakdown = enrollments.flatMap((enrollment) => {
            if (enrollment.courseId === null || enrollment.course === null) {
                return [];
            }
            const courseSessions = sessions.filter((session) => session.courseId === enrollment.courseId && session.section === enrollment.section);
            const presentSessions = courseSessions.filter((session) => presentSessionIds.has(session.id)).length;
            const warning = calculateAttendanceWarning(courseSessions.length, presentSessions);
            return [{
                    course_id: enrollment.course.id,
                    course_code: enrollment.course.courseCode,
                    course_name: enrollment.course.courseName,
                    section: enrollment.section,
                    present_sessions: presentSessions,
                    total_sessions: courseSessions.length,
                    attendance_percentage: warning.attendancePercentage,
                    absence_count: warning.absenceCount,
                    warning_status: warning.status
                }];
        });
        for (const enrollment of enrollments) {
            if (enrollment.courseId === null || enrollment.course === null) {
                continue;
            }
            const courseSessions = sessions.filter((session) => session.courseId === enrollment.courseId && session.section === enrollment.section);
            const presentSessionsForCourse = courseSessions.filter((session) => presentSessionIds.has(session.id)).length;
            const warning = calculateAttendanceWarning(courseSessions.length, presentSessionsForCourse);
            await prisma.attendanceWarning.upsert({
                where: { studentId_courseId: { studentId: student.id, courseId: enrollment.courseId } },
                create: {
                    studentId: student.id,
                    courseId: enrollment.courseId,
                    absenceCount: warning.absenceCount,
                    attendancePercentage: warning.attendancePercentage,
                    status: warning.status
                },
                update: {
                    absenceCount: warning.absenceCount,
                    attendancePercentage: warning.attendancePercentage,
                    status: warning.status
                }
            });
            if (warning.status === "warning" || warning.status === "critical") {
                const message = `Your ${enrollment.course.courseCode}-${enrollment.section} attendance has ${warning.absenceCount} absences (${warning.attendancePercentage}%).`;
                const existingNotification = await prisma.notification.findFirst({
                    where: { studentId: student.id, title: "Attendance warning", message }
                });
                if (!existingNotification) {
                    await prisma.notification.create({
                        data: { studentId: student.id, title: "Attendance warning", message }
                    });
                }
            }
        }
        const totalSessions = sessions.length;
        const presentSessions = attendance.length;
        const today = new Date().toISOString().slice(0, 10);
        let attendanceStreak = 0;
        for (const session of [...sessions].reverse()) {
            if (!presentSessionIds.has(session.id)) {
                break;
            }
            attendanceStreak += 1;
        }
        const warnings = await prisma.attendanceWarning.findMany({
            where: { studentId: student.id, status: { in: ["warning", "critical"] } },
            include: { course: { select: { id: true, courseCode: true, courseName: true } } },
            orderBy: { status: "desc" }
        });
        response.json({
            overall_percentage: totalSessions === 0 ? 0 : Math.round((presentSessions / totalSessions) * 100),
            attendance_streak: attendanceStreak,
            present_today: attendance.some((row) => row.timestamp?.toISOString().slice(0, 10) === today),
            courses: courseBreakdown,
            warnings: warnings.map((warning) => ({
                id: warning.id,
                course_id: warning.course.id,
                course_code: warning.course.courseCode,
                course_name: warning.course.courseName,
                absence_count: warning.absenceCount,
                attendance_percentage: warning.attendancePercentage,
                status: warning.status
            }))
        });
    }
    catch (error) {
        next(error);
    }
});
studentsRouter.get("/courses", requireAuth, requireRole("student"), async (request, response, next) => {
    try {
        const student = await prisma.student.findUnique({ where: { userId: request.user.user_id }, select: { id: true } });
        if (!student) {
            response.status(404).json({ error: "Student profile not found" });
            return;
        }
        const enrollments = await prisma.courseStudent.findMany({
            where: { studentId: student.id },
            include: { course: { select: { courseCode: true, courseName: true } } },
            orderBy: { id: "asc" }
        });
        const courses = await Promise.all(enrollments.flatMap(async (enrollment) => {
            if (!enrollment.courseId || !enrollment.course) {
                return [];
            }
            const sessions = await prisma.attendanceSession.findMany({
                where: { courseId: enrollment.courseId, section: enrollment.section },
                orderBy: { createdAt: "asc" },
                select: { id: true, createdAt: true }
            });
            const attendance = await prisma.attendance.findMany({
                where: { studentId: student.id, sessionId: { in: sessions.map((session) => session.id) } },
                select: { sessionId: true, status: true }
            });
            const statusBySessionId = new Map(attendance.map((row) => [row.sessionId, row.status]));
            const presentCount = sessions.filter((session) => statusBySessionId.get(session.id) === "present").length;
            const warning = calculateAttendanceWarning(sessions.length, presentCount);
            return [{
                    course_code: enrollment.course.courseCode,
                    course_name: enrollment.course.courseName,
                    section: enrollment.section,
                    attendance_percentage: warning.attendancePercentage,
                    present_count: presentCount,
                    absent_count: warning.absenceCount,
                    warning_status: warning.status,
                    history: sessions.map((session) => ({
                        date: session.createdAt,
                        status: statusBySessionId.get(session.id) === "present" ? "present" : "absent"
                    }))
                }];
        })).then((rows) => rows.flat());
        response.json({ courses });
    }
    catch (error) {
        next(error);
    }
});
studentsRouter.patch("/device", requireAuth, requireRole("student"), async (request, response, next) => {
    const parsed = registerDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
        response.status(400).json({ error: "Invalid device data" });
        return;
    }
    try {
        const student = await prisma.student.findUnique({ where: { userId: request.user.user_id } });
        if (!student) {
            response.status(404).json({ error: "Student profile not found" });
            return;
        }
        if (student.deviceId && student.deviceId !== parsed.data.device_id) {
            response.status(409).json({ error: "A different device is already registered for this account." });
            return;
        }
        if (!student.deviceId) {
            await prisma.student.update({ where: { id: student.id }, data: { deviceId: parsed.data.device_id } });
        }
        response.json({ status: "ok" });
    }
    catch (error) {
        next(error);
    }
});
studentsRouter.patch("/profile/password", requireAuth, requireRole("student"), async (request, response, next) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
        response.status(400).json({ error: "Invalid password data", details: parsed.error.flatten() });
        return;
    }
    try {
        const user = await prisma.user.findUnique({ where: { id: request.user.user_id } });
        if (!user || user.role !== "student") {
            response.status(404).json({ error: "Student account not found" });
            return;
        }
        if (!(await bcrypt.compare(parsed.data.current_password, user.password))) {
            response.status(401).json({ error: "Current password is incorrect" });
            return;
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { password: await bcrypt.hash(parsed.data.new_password, 12) }
        });
        response.json({ status: "ok" });
    }
    catch (error) {
        next(error);
    }
});
export { studentsRouter };
