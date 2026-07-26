import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import jwt from "jsonwebtoken";

import { requireAuth, requireRole } from "./middleware.js";
import { prisma } from "../prisma/client.js";
import { getJwtSecret } from "./jwt.js";
import { loginSchema, signupSchema } from "./validation.js";
import { loginRateLimiter, signupRateLimiter } from "../security/rate-limit.js";

const authRouter = Router();
const passwordSaltRounds = 12;

function getUniqueConflict(error: Prisma.PrismaClientKnownRequestError) {
  const target = Array.isArray(error.meta?.target)
    ? error.meta.target.map(String).join(",")
    : String(error.meta?.target ?? "");

  if (target.includes("email")) {
    return { error: "Email is already registered", field: "email" };
  }

  if (target.includes("student_id") || target.includes("studentId")) {
    return { error: "Student ID is already registered", field: "student_id" };
  }

  if (target.includes("employee_id") || target.includes("employeeId")) {
    return { error: "Employee ID is already registered", field: "employee_id" };
  }

  return { error: "A unique signup field is already registered" };
}

// Kept for admin tooling only; no anonymous account creation path exists.
authRouter.post("/signup", requireAuth, requireRole("admin"), signupRateLimiter, async (request, response, next) => {
  const parsed = signupSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid signup data", details: parsed.error.flatten() });
    return;
  }

  try {
    const input = parsed.data;
    const passwordHash = await bcrypt.hash(input.password, passwordSaltRounds);
    const user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: {
          name: input.name,
          email: input.email,
          password: passwordHash,
          role: input.role
        }
      });

      switch (input.role) {
        case "student":
          await transaction.student.create({
            data: {
              userId: createdUser.id,
              studentId: input.student_id,
              department: input.department,
              semester: input.semester
            }
          });
          break;
        case "professor":
          await transaction.professor.create({
            data: {
              userId: createdUser.id,
              employeeId: input.employee_id,
              department: input.department
            }
          });
          break;
        case "admin":
          await transaction.admin.create({
            data: {
              userId: createdUser.id,
              adminCode: input.admin_code
            }
          });
          break;
      }

      return createdUser;
    });

    response.status(201).json({ user: { name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json(getUniqueConflict(error));
      return;
    }

    next(error);
  }
});

authRouter.post("/login", loginRateLimiter, async (request, response, next) => {
  const parsed = loginSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid login data", details: parsed.error.flatten() });
    return;
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: parsed.data.email, mode: "insensitive" } },
      include: { student: { select: { deviceId: true } } }
    });
    const passwordMatches = user ? await bcrypt.compare(parsed.data.password, user.password) : false;

    if (!user || !passwordMatches) {
      response.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = jwt.sign({ user_id: user.id, role: user.role }, getJwtSecret(), { expiresIn: "7d" });
    response.json({
      token,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        // The mobile app uses this only during a newly completed sign-in.
        device_binding_required: user.role === "student" && user.student?.deviceId === null
      }
    });
  } catch (error) {
    next(error);
  }
});

export { authRouter };
