import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

import { calculateAttendanceWarning } from "../src/attendance/warnings.js";

const prisma = new PrismaClient();
const passwordSaltRounds = 12;

const accounts = {
  admin: {
    name: "Demo Admin",
    email: "admin@demo.yupresence.local",
    password: "AdminDemo!2026",
    adminCode: "ADMIN-DEMO-2026"
  },
  professors: [
    {
      name: "Alice Morgan",
      email: "professor.alice@demo.yupresence.local",
      password: "ProfessorAlice!2026",
      employeeId: "EMP-2026-001",
      department: "Computer Science"
    },
    {
      name: "Bilal Khan",
      email: "professor.bilal@demo.yupresence.local",
      password: "ProfessorBilal!2026",
      employeeId: "EMP-2026-002",
      department: "Mathematics"
    },
    {
      name: "Charlie Reed",
      email: "professor.charlie@demo.yupresence.local",
      password: "ProfessorCharlie!2026",
      employeeId: "EMP-2026-003",
      department: "Information Systems"
    }
  ],
  students: [
    ["Aisha Khan", "student.aisha@demo.yupresence.local", "StudentAisha!2026", "2026001", "Computer Science", 6],
    ["Diddy Khan", "student.diddy@demo.yupresence.local", "StudentDiddy!2026", "2026002", "Computer Science", 6],
    ["Maya Patel", "student.maya@demo.yupresence.local", "StudentMaya!2026", "2026003", "Computer Science", 6],
    ["Omar Hassan", "student.omar@demo.yupresence.local", "StudentOmar!2026", "2026004", "Mathematics", 4],
    ["Sara Noor", "student.sara@demo.yupresence.local", "StudentSara!2026", "2026005", "Information Systems", 4],
    ["Yusuf Ali", "student.yusuf@demo.yupresence.local", "StudentYusuf!2026", "2026006", "Mathematics", 4]
  ] as const
} as const;

const courses = [
  { courseName: "Introduction to Computer Science", courseCode: "CS101", semester: 6 },
  { courseName: "Discrete Mathematics", courseCode: "MATH201", semester: 4 },
  { courseName: "Data Systems", courseCode: "IS301", semester: 4 }
] as const;

const teachingAssignments = [
  { courseCode: "CS101", section: "287", professorIndex: 0 },
  { courseCode: "MATH201", section: "201", professorIndex: 0 },
  { courseCode: "CS101", section: "591", professorIndex: 1 },
  { courseCode: "IS301", section: "880", professorIndex: 1 },
  { courseCode: "MATH201", section: "202", professorIndex: 2 },
  { courseCode: "IS301", section: "881", professorIndex: 2 }
] as const;

const studentEnrollments = [
  { studentIndex: 0, courseCode: "CS101", section: "287" },
  { studentIndex: 0, courseCode: "MATH201", section: "201" },
  { studentIndex: 1, courseCode: "CS101", section: "591" },
  { studentIndex: 1, courseCode: "IS301", section: "880" },
  { studentIndex: 2, courseCode: "MATH201", section: "202" },
  { studentIndex: 2, courseCode: "IS301", section: "881" },
  { studentIndex: 3, courseCode: "CS101", section: "287" },
  { studentIndex: 3, courseCode: "IS301", section: "880" },
  { studentIndex: 4, courseCode: "MATH201", section: "201" },
  { studentIndex: 4, courseCode: "IS301", section: "881" },
  { studentIndex: 5, courseCode: "CS101", section: "591" },
  { studentIndex: 5, courseCode: "MATH201", section: "202" }
] as const;

const sessionDefinitions = [
  { courseCode: "CS101", section: "287", professorIndex: 0, dates: ["2026-06-01", "2026-06-08", "2026-06-15"], present: [[0], [0, 3], [0]] },
  { courseCode: "CS101", section: "591", professorIndex: 1, dates: ["2026-06-02", "2026-06-09", "2026-06-16"], present: [[1], [1, 5], [5]] },
  { courseCode: "MATH201", section: "201", professorIndex: 0, dates: ["2026-05-06", "2026-05-13", "2026-05-20", "2026-05-27", "2026-06-03", "2026-06-10", "2026-06-17", "2026-06-24", "2026-07-01", "2026-07-08"], present: [[4], [4], [4], [4], [0], [0, 4], [4], [4], [4], [4]] },
  { courseCode: "MATH201", section: "202", professorIndex: 2, dates: ["2026-06-04", "2026-06-11", "2026-06-18"], present: [[2], [2, 5], [5]] },
  { courseCode: "IS301", section: "880", professorIndex: 1, dates: ["2026-06-05", "2026-06-12", "2026-06-19"], present: [[1], [1, 3], [1]] },
  { courseCode: "IS301", section: "881", professorIndex: 2, dates: ["2026-06-06", "2026-06-13", "2026-06-20"], present: [[2, 4], [2], [2, 4]] }
] as const;

async function hashPassword(password: string) {
  return bcrypt.hash(password, passwordSaltRounds);
}

async function main() {
  await prisma.$transaction(async (db) => {
    await db.attendance.deleteMany();
    await db.scanAttempt.deleteMany();
    await db.notification.deleteMany();
    await db.attendanceWarning.deleteMany();
    await db.attendanceSession.deleteMany();
    await db.courseStudent.deleteMany();
    await db.courseProfessor.deleteMany();
    await db.courseSection.deleteMany();
    await db.student.deleteMany();
    await db.professor.deleteMany();
    await db.admin.deleteMany();
    await db.course.deleteMany();
    await db.user.deleteMany();

    const adminUser = await db.user.create({
      data: {
        name: accounts.admin.name,
        email: accounts.admin.email,
        password: await hashPassword(accounts.admin.password),
        role: "admin"
      }
    });
    await db.admin.create({ data: { userId: adminUser.id, adminCode: accounts.admin.adminCode } });

    const professors = [];
    for (const account of accounts.professors) {
      const user = await db.user.create({
        data: {
          name: account.name,
          email: account.email,
          password: await hashPassword(account.password),
          role: "professor"
        }
      });
      professors.push(
        await db.professor.create({
          data: { userId: user.id, employeeId: account.employeeId, department: account.department }
        })
      );
    }

    const students = [];
    for (const [name, email, password, studentId, department, semester] of accounts.students) {
      const user = await db.user.create({
        data: { name, email, password: await hashPassword(password), role: "student" }
      });
      students.push(
        await db.student.create({ data: { userId: user.id, studentId, department, semester } })
      );
    }

    for (const course of courses) {
      await db.course.create({ data: course });
    }

    const courseIdByCode = new Map<string, number>();
    for (const course of await db.course.findMany({ where: { courseCode: { in: courses.map((item) => item.courseCode) } } })) {
      courseIdByCode.set(course.courseCode, course.id);
    }

    const sectionRows = new Map<string, { courseId: number; section: string }>();
    for (const assignment of teachingAssignments) {
      const courseId = courseIdByCode.get(assignment.courseCode);
      if (courseId) sectionRows.set(`${courseId}-${assignment.section}`, { courseId, section: assignment.section });
    }
    for (const enrollment of studentEnrollments) {
      const courseId = courseIdByCode.get(enrollment.courseCode);
      if (courseId) sectionRows.set(`${courseId}-${enrollment.section}`, { courseId, section: enrollment.section });
    }
    await db.courseSection.createMany({ data: [...sectionRows.values()] });

    for (const assignment of teachingAssignments) {
      await db.courseProfessor.create({
        data: {
          courseId: courseIdByCode.get(assignment.courseCode),
          professorId: professors[assignment.professorIndex].id,
          section: assignment.section
        }
      });
    }

    for (const enrollment of studentEnrollments) {
      await db.courseStudent.create({
        data: {
          courseId: courseIdByCode.get(enrollment.courseCode),
          studentId: students[enrollment.studentIndex].id,
          section: enrollment.section
        }
      });
    }

    for (const definition of sessionDefinitions) {
      const courseId = courseIdByCode.get(definition.courseCode);
      const professorId = professors[definition.professorIndex].id;

      for (let sessionIndex = 0; sessionIndex < definition.dates.length; sessionIndex += 1) {
        const createdAt = new Date(`${definition.dates[sessionIndex]}T09:00:00.000Z`);
        const session = await db.attendanceSession.create({
          data: {
            courseId,
            professorId,
            section: definition.section,
            latitude: 24.7136,
            longitude: 46.6753,
            radius: 40,
            status: "ended",
            createdAt,
            expiresAt: new Date(createdAt.getTime() + 90 * 60 * 1000)
          }
        });

        for (const studentIndex of definition.present[sessionIndex]) {
          const isEnrolled = studentEnrollments.some(
            (enrollment) =>
              enrollment.studentIndex === studentIndex &&
              enrollment.courseCode === definition.courseCode &&
              enrollment.section === definition.section
          );
          if (!isEnrolled) {
            throw new Error(`Seed attendance mismatch for ${definition.courseCode}-${definition.section}`);
          }

          await db.attendance.create({
            data: {
              sessionId: session.id,
              studentId: students[studentIndex].id,
              status: "present",
              timestamp: createdAt
            }
          });
        }
      }
    }

    for (let studentIndex = 0; studentIndex < students.length; studentIndex += 1) {
      const student = students[studentIndex];
      const enrollments = studentEnrollments.filter((item) => item.studentIndex === studentIndex);
      for (const enrollment of enrollments) {
        const courseId = courseIdByCode.get(enrollment.courseCode);
        const totalSessions = await db.attendanceSession.count({
          where: { courseId, section: enrollment.section }
        });
        const presentSessions = await db.attendance.count({
          where: {
            studentId: student.id,
            status: "present",
            session: { courseId, section: enrollment.section }
          }
        });
        const { absenceCount, attendancePercentage, status } = calculateAttendanceWarning(totalSessions, presentSessions);

        await db.attendanceWarning.create({
          data: { studentId: student.id, courseId, absenceCount, attendancePercentage, status }
        });
        if (status === "warning" || status === "critical") {
          await db.notification.create({
            data: {
              studentId: student.id,
              title: "Attendance warning",
              message: `Your ${enrollment.courseCode}-${enrollment.section} attendance has ${absenceCount} absences (${attendancePercentage}%).`
            }
          });
        }
      }
    }

    console.log("Seeded 1 admin, 3 professors, 6 students, 3 courses, 6 teaching assignments, 12 enrollments, 25 sessions, and section-matched attendance history.");
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
