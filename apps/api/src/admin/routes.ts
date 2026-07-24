import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { Router } from "express";

import { requireAuth, requireRole } from "../auth/middleware.js";
import { changePasswordSchema } from "../students/validation.js";
import { prisma } from "../prisma/client.js";
import { assignProfessorSchema, createAdminUserSchema, createCourseSchema, enrollStudentSchema, updateCourseSchema } from "./validation.js";

const adminRouter = Router();
const passwordSaltRounds = 12;

function uniqueConflict(error: Prisma.PrismaClientKnownRequestError) {
  const target = Array.isArray(error.meta?.target) ? error.meta.target.map(String).join(",") : String(error.meta?.target ?? "");
  if (target.includes("email")) return "Email is already registered";
  if (target.includes("student_id") || target.includes("studentId")) return "Student ID is already registered";
  if (target.includes("employee_id") || target.includes("employeeId")) return "Employee ID is already registered";
  if (target.includes("course_code") || target.includes("courseCode")) return "Course code is already registered";
  return "This record already exists";
}

function normalizedSections(sections: string[]) {
  return [...new Set(sections.map((section) => section.trim()).filter(Boolean))];
}

async function courseSectionExists(courseId: number, section: string) {
  return prisma.courseSection.findUnique({ where: { courseId_section: { courseId, section } }, select: { id: true } });
}

adminRouter.use(requireAuth, requireRole("admin"));

adminRouter.get("/statistics", async (_request, response, next) => {
  try {
    const [students, professors, courses, sections, sessions] = await Promise.all([
      prisma.student.count(),
      prisma.professor.count(),
      prisma.course.count(),
      prisma.courseSection.count(),
      prisma.attendanceSession.count()
    ]);
    response.json({ students, professors, courses, sections, sessions });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/profile", async (request, response, next) => {
  try {
    const admin = await prisma.admin.findUnique({ where: { userId: request.user!.user_id }, include: { user: { select: { name: true, email: true } } } });
    if (!admin?.user) { response.status(404).json({ error: "Admin profile not found" }); return; }
    response.json({ name: admin.user.name, email: admin.user.email, admin_code: admin.adminCode });
  } catch (error) { next(error); }
});

adminRouter.patch("/profile/password", async (request, response, next) => {
  const parsed = changePasswordSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid password data", details: parsed.error.flatten() }); return; }
  try {
    const user = await prisma.user.findUnique({ where: { id: request.user!.user_id } });
    if (!user || user.role !== "admin" || !(await bcrypt.compare(parsed.data.current_password, user.password))) {
      response.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(parsed.data.new_password, passwordSaltRounds) } });
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

adminRouter.get("/catalog", async (_request, response, next) => {
  try {
    const [courses, professors, students] = await Promise.all([
      prisma.course.findMany({
        include: { sections: { select: { section: true }, orderBy: { section: "asc" } } },
        orderBy: { courseCode: "asc" }
      }),
      prisma.professor.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { employeeId: "asc" }
      }),
      prisma.student.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { studentId: "asc" }
      })
    ]);
    response.json({
      courses: courses.map((course) => ({
        course_id: course.id,
        course_code: course.courseCode,
        course_name: course.courseName,
        semester: course.semester,
        sections: course.sections.map((row) => row.section)
      })),
      professors: professors.flatMap((professor) => professor.user ? [{
        professor_id: professor.id,
        name: professor.user.name,
        email: professor.user.email,
        employee_id: professor.employeeId,
        department: professor.department
      }] : []),
      students: students.flatMap((student) => student.user ? [{
        student_id: student.id,
        university_student_id: student.studentId,
        name: student.user.name,
        email: student.user.email,
        department: student.department,
        semester: student.semester
      }] : [])
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/create-course", async (request, response, next) => {
  const parsed = createCourseSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid course data", details: parsed.error.flatten() });
    return;
  }
  try {
    const sections = normalizedSections(parsed.data.sections);
    const course = await prisma.course.create({
      data: {
        courseCode: parsed.data.course_code,
        courseName: parsed.data.course_name,
        semester: parsed.data.semester ?? null,
        sections: { create: sections.map((section) => ({ section })) }
      },
      include: { sections: { select: { section: true }, orderBy: { section: "asc" } } }
    });
    response.status(201).json({
      course: { course_id: course.id, course_code: course.courseCode, course_name: course.courseName, semester: course.semester, sections: course.sections.map((row) => row.section) }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: uniqueConflict(error) });
      return;
    }
    next(error);
  }
});

adminRouter.patch("/courses/:courseId", async (request, response, next) => {
  const courseId = Number(request.params.courseId);
  const parsed = updateCourseSchema.safeParse(request.body);
  if (!Number.isInteger(courseId) || courseId <= 0 || !parsed.success) {
    response.status(400).json({ error: "Invalid course update", details: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  try {
    const addedSections = normalizedSections(parsed.data.add_sections ?? []);
    const course = await prisma.course.update({
      where: { id: courseId },
      data: {
        ...(parsed.data.course_code ? { courseCode: parsed.data.course_code } : {}),
        ...(parsed.data.course_name ? { courseName: parsed.data.course_name } : {}),
        ...(parsed.data.semester !== undefined ? { semester: parsed.data.semester } : {}),
        ...(addedSections.length ? { sections: { createMany: { data: addedSections.map((section) => ({ section })), skipDuplicates: true } } } : {})
      },
      include: { sections: { select: { section: true }, orderBy: { section: "asc" } } }
    });
    response.json({ course: { course_id: course.id, course_code: course.courseCode, course_name: course.courseName, semester: course.semester, sections: course.sections.map((row) => row.section) } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      response.status(404).json({ error: "Course not found" });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: uniqueConflict(error) });
      return;
    }
    next(error);
  }
});

adminRouter.post("/create-user", async (request, response, next) => {
  const parsed = createAdminUserSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid account data", details: parsed.error.flatten() });
    return;
  }
  try {
    const input = parsed.data;
    const password = await bcrypt.hash(input.password, passwordSaltRounds);
    const account = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { name: input.name, email: input.email, password, role: input.role } });
      if (input.role === "professor") {
        const professor = await transaction.professor.create({ data: { userId: user.id, employeeId: input.employee_id, department: input.department } });
        return { role: "professor" as const, id: professor.id, user };
      }
      const student = await transaction.student.create({ data: { userId: user.id, studentId: input.student_id, department: input.department, semester: input.semester } });
      return { role: "student" as const, id: student.id, user };
    });
    response.status(201).json({ user: { id: account.id, name: account.user.name, email: account.user.email, role: account.role } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: uniqueConflict(error) });
      return;
    }
    next(error);
  }
});

adminRouter.post("/assign-professor", async (request, response, next) => {
  const parsed = assignProfessorSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid teaching assignment", details: parsed.error.flatten() });
    return;
  }
  try {
    const [section, professor] = await Promise.all([
      courseSectionExists(parsed.data.course_id, parsed.data.section),
      prisma.professor.findUnique({ where: { id: parsed.data.professor_id }, select: { id: true } })
    ]);
    if (!section || !professor) {
      response.status(404).json({ error: !section ? "Course-section not found" : "Professor not found" });
      return;
    }
    await prisma.courseProfessor.create({ data: { courseId: parsed.data.course_id, professorId: parsed.data.professor_id, section: parsed.data.section } });
    response.status(201).json({ status: "assigned" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: "This professor is already assigned to that course-section" });
      return;
    }
    next(error);
  }
});

adminRouter.post("/enroll-student", async (request, response, next) => {
  const parsed = enrollStudentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid enrollment", details: parsed.error.flatten() });
    return;
  }
  try {
    const [section, student] = await Promise.all([
      courseSectionExists(parsed.data.course_id, parsed.data.section),
      prisma.student.findUnique({ where: { id: parsed.data.student_id }, select: { id: true } })
    ]);
    if (!section || !student) {
      response.status(404).json({ error: !section ? "Course-section not found" : "Student not found" });
      return;
    }
    const enrollment = await prisma.courseStudent.upsert({
      where: { courseId_studentId: { courseId: parsed.data.course_id, studentId: parsed.data.student_id } },
      create: { courseId: parsed.data.course_id, studentId: parsed.data.student_id, section: parsed.data.section },
      update: { section: parsed.data.section }
    });
    response.json({ status: "enrolled", enrollment_id: enrollment.id });
  } catch (error) {
    next(error);
  }
});

export { adminRouter };
