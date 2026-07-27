import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { Prisma } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";

import { requireAuth, requireRole } from "../auth/middleware.js";
import { getJwtSecret } from "../auth/jwt.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { prisma } from "../prisma/client.js";
import { appealIdParamSchema, appealStatusQuerySchema, createAppealSchema } from "./validation.js";

const appealsRouter = Router();
const appealWindowMs = 7 * 24 * 60 * 60 * 1000;
const attachmentViewTokenLifetimeSeconds = 60;
const uploadsDirectory = resolve(process.cwd(), "uploads", "appeals");
const permittedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

mkdirSync(uploadsDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadsDirectory),
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!permittedMimeTypes.has(file.mimetype)) {
      callback(new Error("Attachments must be an image or PDF file."));
      return;
    }
    callback(null, true);
  }
});

async function removeUploadedFile(file?: Express.Multer.File) {
  if (!file) return;
  await unlink(file.path).catch(() => undefined);
}

function appealInclude() {
  return {
    student: { include: { user: { select: { name: true } } } },
    session: {
      include: {
        course: { select: { courseCode: true, courseName: true } },
        professor: { include: { user: { select: { name: true } } } }
      }
    },
    resolvedByUser: { select: { name: true } }
  } satisfies Prisma.AppealInclude;
}

type AppealWithDetails = Prisma.AppealGetPayload<{ include: ReturnType<typeof appealInclude> }>;

function serializeAppeal(appeal: AppealWithDetails) {
  return {
    appeal_id: appeal.id,
    session_id: appeal.sessionId,
    student_name: appeal.student.user?.name ?? "Student",
    student_id: appeal.student.studentId,
    course_code: appeal.session.course?.courseCode ?? "Course",
    course_name: appeal.session.course?.courseName ?? "",
    section: appeal.session.section,
    session_date: appeal.session.createdAt,
    message: appeal.message,
    has_attachment: Boolean(appeal.attachmentPath),
    status: appeal.status,
    resolved_by_role: appeal.resolvedByRole,
    resolved_by_name: appeal.resolvedByUser?.name ?? null,
    resolved_at: appeal.resolvedAt,
    created_at: appeal.createdAt
  };
}

async function getResolverScope(user: AuthenticatedUser): Promise<{ role: "admin" | "professor"; where: Prisma.AppealWhereInput } | null> {
  if (user.role === "admin") return { role: "admin", where: {} };
  if (user.role !== "professor") return null;

  const professor = await prisma.professor.findUnique({ where: { userId: user.user_id }, select: { id: true } });
  return professor ? { role: "professor", where: { session: { professorId: professor.id } } } : null;
}

function attachmentMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".heic": return "image/heic";
    case ".heif": return "image/heif";
    default: return "image/jpeg";
  }
}

async function findAccessibleAttachment(appealId: number, user: AuthenticatedUser) {
  const appeal = await prisma.appeal.findUnique({
    where: { id: appealId },
    include: { session: { select: { professorId: true } }, student: { select: { userId: true } } }
  });
  if (!appeal?.attachmentPath) return { appeal: null, allowed: false };

  let allowed = user.role === "admin" || (user.role === "student" && appeal.student.userId === user.user_id);
  if (!allowed && user.role === "professor") {
    const professor = await prisma.professor.findUnique({ where: { userId: user.user_id }, select: { id: true } });
    allowed = professor?.id === appeal.session.professorId;
  }
  return { appeal, allowed };
}

appealsRouter.post("/", requireAuth, requireRole("student"), upload.single("attachment"), async (request, response, next) => {
  const parsed = createAppealSchema.safeParse(request.body);
  let persistedAttachment = false;

  if (!parsed.success) {
    await removeUploadedFile(request.file);
    response.status(400).json({ error: "Provide a session and an appeal message up to 4,000 characters." });
    return;
  }

  try {
    const student = await prisma.student.findUnique({ where: { userId: request.user!.user_id }, select: { id: true } });
    const session = await prisma.attendanceSession.findUnique({
      where: { id: parsed.data.session_id },
      select: { id: true, courseId: true, section: true, status: true, createdAt: true }
    });
    if (!student || !session?.courseId) {
      response.status(404).json({ error: "Attendance session not found." });
      return;
    }
    if (session.status !== "ended") {
      response.status(409).json({ error: "Appeals can only be submitted after a session has ended." });
      return;
    }
    if (!session.createdAt || Date.now() - session.createdAt.getTime() > appealWindowMs) {
      response.status(409).json({ error: "The seven-day appeal window for this session has closed." });
      return;
    }

    const [enrollment, attendance] = await Promise.all([
      prisma.courseStudent.findFirst({
        where: { studentId: student.id, courseId: session.courseId, section: session.section },
        select: { id: true }
      }),
      prisma.attendance.findUnique({
        where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
        select: { id: true, status: true }
      })
    ]);
    if (!enrollment) {
      response.status(403).json({ error: "You are not enrolled in this course-section." });
      return;
    }
    if (attendance?.status === "present") {
      response.status(409).json({ error: "Present sessions cannot be appealed." });
      return;
    }

    const appeal = await prisma.appeal.create({
      data: {
        sessionId: session.id,
        studentId: student.id,
        message: parsed.data.message,
        attachmentPath: request.file ? basename(request.file.filename) : null
      },
      include: appealInclude()
    });
    persistedAttachment = Boolean(request.file);
    response.status(201).json({ appeal: serializeAppeal(appeal) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: "An appeal already exists for this absence." });
      return;
    }
    next(error);
  } finally {
    if (!persistedAttachment) await removeUploadedFile(request.file);
  }
});

appealsRouter.get("/", requireAuth, requireRole("professor", "admin"), async (request, response, next) => {
  const parsed = appealStatusQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid appeal filter." });
    return;
  }

  try {
    const scope = await getResolverScope(request.user!);
    if (!scope) {
      response.status(403).json({ error: "Professor profile not found." });
      return;
    }
    const appeals = await prisma.appeal.findMany({
      where: {
        ...scope.where,
        ...(parsed.data.status === "all" ? {} : { status: parsed.data.status })
      },
      include: appealInclude(),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    });
    response.json({ appeals: appeals.map(serializeAppeal) });
  } catch (error) {
    throw error;
  }
});

appealsRouter.post("/:appealId/view-link", requireAuth, async (request, response, next) => {
  const parsed = appealIdParamSchema.safeParse(request.params.appealId);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid appeal id." });
    return;
  }

  try {
    const { appeal, allowed } = await findAccessibleAttachment(parsed.data, request.user!);
    if (!appeal) {
      response.status(404).json({ error: "Attachment not found." });
      return;
    }
    if (!allowed) {
      response.status(403).json({ error: "You do not have access to this attachment." });
      return;
    }
    const token = jwt.sign({ purpose: "appeal_attachment_view", appeal_id: appeal.id, user_id: request.user!.user_id, role: request.user!.role }, getJwtSecret(), { expiresIn: attachmentViewTokenLifetimeSeconds });
    response.json({
      url: `${request.protocol}://${request.get("host")}/appeals/${appeal.id}/view?token=${encodeURIComponent(token)}`,
      mime_type: attachmentMimeType(appeal.attachmentPath!)
    });
  } catch (error) {
    next(error);
  }
});

appealsRouter.get("/:appealId/view", async (request, response, next) => {
  const parsed = appealIdParamSchema.safeParse(request.params.appealId);
  const token = typeof request.query.token === "string" ? request.query.token : null;
  if (!parsed.success || !token) {
    response.status(400).json({ error: "Invalid attachment link." });
    return;
  }

  try {
    const claims = jwt.verify(token, getJwtSecret());
    const isRole = typeof claims !== "string" && (claims.role === "student" || claims.role === "professor" || claims.role === "admin");
    const isValidClaims = typeof claims !== "string" && claims.purpose === "appeal_attachment_view" && claims.appeal_id === parsed.data && Number.isInteger(claims.user_id) && isRole;
    if (!isValidClaims) {
      response.status(401).json({ error: "Invalid or expired attachment link." });
      return;
    }
    const { appeal, allowed } = await findAccessibleAttachment(parsed.data, { user_id: claims.user_id, role: claims.role });
    // The signed link represents the authenticated user that requested it.
    if (!appeal || !allowed) {
      response.status(403).json({ error: "Attachment link is no longer valid." });
      return;
    }
    const filePath = resolve(uploadsDirectory, basename(appeal.attachmentPath!));
    if (!existsSync(filePath)) {
      response.status(404).json({ error: "Attachment file is unavailable." });
      return;
    }
    response.type(attachmentMimeType(filePath));
    response.sendFile(filePath);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      response.status(401).json({ error: "Invalid or expired attachment link." });
      return;
    }
    next(error);
  }
});

appealsRouter.get("/:appealId/attachment", requireAuth, async (request, response, next) => {
  const parsed = appealIdParamSchema.safeParse(request.params.appealId);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid appeal id." });
    return;
  }
  try {
    const { appeal, allowed } = await findAccessibleAttachment(parsed.data, request.user!);
    if (!appeal) { response.status(404).json({ error: "Attachment not found." }); return; }
    if (!allowed) { response.status(403).json({ error: "You do not have access to this attachment." }); return; }
    const filePath = resolve(uploadsDirectory, basename(appeal.attachmentPath!));
    if (!existsSync(filePath)) { response.status(404).json({ error: "Attachment file is unavailable." }); return; }
    response.download(filePath, `appeal-${appeal.id}${extname(filePath)}`);
  } catch (error) { next(error); }
});

async function resolveAppeal(request: Request, response: Response, decision: "accepted" | "rejected") {
  const parsed = appealIdParamSchema.safeParse(request.params.appealId);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid appeal id." });
    return;
  }

  try {
    const scope = await getResolverScope(request.user!);
    if (!scope) {
      response.status(403).json({ error: "Professor profile not found." });
      return;
    }

    const resolved = await prisma.$transaction(async (transaction) => {
      const appeal = await transaction.appeal.findFirst({
        where: { id: parsed.data, ...scope.where },
        include: appealInclude()
      });
      if (!appeal) return { kind: "not_found" as const };

      const claimed = await transaction.appeal.updateMany({
        where: { id: appeal.id, status: "pending" },
        data: {
          status: decision,
          resolvedByRole: scope.role,
          resolvedByUserId: request.user!.user_id,
          resolvedAt: new Date()
        }
      });
      if (claimed.count !== 1) return { kind: "already_resolved" as const };

      if (decision === "accepted") {
        await transaction.attendance.upsert({
          where: { sessionId_studentId: { sessionId: appeal.sessionId, studentId: appeal.studentId } },
          create: { sessionId: appeal.sessionId, studentId: appeal.studentId, status: "present", manualOverride: true },
          update: { status: "present", manualOverride: true }
        });
      }

      const updated = await transaction.appeal.findUniqueOrThrow({ where: { id: appeal.id }, include: appealInclude() });
      return { kind: "resolved" as const, appeal: updated };
    });

    if (resolved.kind === "not_found") {
      response.status(404).json({ error: "Pending appeal not found." });
      return;
    }
    if (resolved.kind === "already_resolved") {
      response.status(409).json({ error: "This appeal was already resolved." });
      return;
    }

    await prisma.notification.create({
      data: {
        studentId: resolved.appeal.studentId,
        title: "Attendance appeal updated",
        message: `Your appeal for ${resolved.appeal.session.course?.courseCode ?? "this session"} — Section ${resolved.appeal.session.section} was ${decision}.`
      }
    });
    response.json({ appeal: serializeAppeal(resolved.appeal) });
  } catch (error) {
    throw error;
  }
}

appealsRouter.post("/:appealId/accept", requireAuth, requireRole("professor", "admin"), (request, response, next) => {
  void resolveAppeal(request, response, "accepted").catch(next);
});
appealsRouter.post("/:appealId/reject", requireAuth, requireRole("professor", "admin"), (request, response, next) => {
  void resolveAppeal(request, response, "rejected").catch(next);
});

appealsRouter.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    void removeUploadedFile(request.file).finally(() => response.status(400).json({ error: "Attachments must be 10 MB or smaller." }));
    return;
  }
  if (error instanceof Error && error.message === "Attachments must be an image or PDF file.") {
    void removeUploadedFile(request.file).finally(() => response.status(400).json({ error: error.message }));
    return;
  }
  next(error);
});

export { appealsRouter };
