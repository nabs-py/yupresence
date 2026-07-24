import { z } from "zod";

const sectionSchema = z.string().trim().min(1).max(255);

export const createCourseSchema = z.object({
  course_code: z.string().trim().min(1).max(255),
  course_name: z.string().trim().min(1).max(255),
  semester: z.number().int().positive().nullable().optional(),
  sections: z.array(sectionSchema).min(1).max(100)
});

export const updateCourseSchema = z.object({
  course_code: z.string().trim().min(1).max(255).optional(),
  course_name: z.string().trim().min(1).max(255).optional(),
  semester: z.number().int().positive().nullable().optional(),
  add_sections: z.array(sectionSchema).min(1).max(100).optional()
}).refine((input) => Object.keys(input).length > 0, { message: "Provide at least one course update" });

export const createAdminUserSchema = z.discriminatedUnion("role", [
  z.object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(8).max(72),
    role: z.literal("professor"),
    employee_id: z.string().trim().min(1).max(255),
    department: z.string().trim().min(1).max(255)
  }),
  z.object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(8).max(72),
    role: z.literal("student"),
    student_id: z.string().trim().min(1).max(255),
    department: z.string().trim().min(1).max(255),
    semester: z.number().int().positive()
  })
]);

export const assignProfessorSchema = z.object({
  course_id: z.number().int().positive(),
  professor_id: z.number().int().positive(),
  section: sectionSchema
});

export const enrollStudentSchema = z.object({
  course_id: z.number().int().positive(),
  student_id: z.number().int().positive(),
  section: sectionSchema
});
