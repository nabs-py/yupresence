import bcrypt from "bcrypt";
import { Router } from "express";

import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../prisma/client.js";
import { changePasswordSchema } from "../students/validation.js";

const professorsRouter = Router();

professorsRouter.get("/profile", requireAuth, requireRole("professor"), async (request, response, next) => {
  try {
    const professor = await prisma.professor.findUnique({
      where: { userId: request.user!.user_id },
      include: { user: { select: { name: true, email: true } } }
    });
    if (!professor?.user) {
      response.status(404).json({ error: "Professor profile not found" });
      return;
    }
    response.json({ name: professor.user.name, email: professor.user.email, employee_id: professor.employeeId, department: professor.department });
  } catch (error) { next(error); }
});

professorsRouter.patch("/profile/password", requireAuth, requireRole("professor"), async (request, response, next) => {
  const parsed = changePasswordSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid password data", details: parsed.error.flatten() }); return; }
  try {
    const user = await prisma.user.findUnique({ where: { id: request.user!.user_id } });
    if (!user || user.role !== "professor" || !(await bcrypt.compare(parsed.data.current_password, user.password))) {
      response.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(parsed.data.new_password, 12) } });
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

export { professorsRouter };
