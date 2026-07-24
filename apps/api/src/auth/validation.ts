import { z } from "zod";

const baseSignupSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(72)
});

export const signupSchema = z.discriminatedUnion("role", [
  baseSignupSchema.extend({
    role: z.literal("student"),
    student_id: z.string().trim().min(1).max(255),
    department: z.string().trim().min(1).max(255),
    semester: z.number().int().positive()
  }),
  baseSignupSchema.extend({
    role: z.literal("professor"),
    employee_id: z.string().trim().min(1).max(255),
    department: z.string().trim().min(1).max(255)
  }),
  baseSignupSchema.extend({
    role: z.literal("admin"),
    admin_code: z.string().trim().min(1).max(255)
  })
]);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(72)
});
