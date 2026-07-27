import { z } from "zod";

export const createAppealSchema = z.object({
  session_id: z.coerce.number().int().positive(),
  message: z.string().trim().min(1).max(4_000)
});

export const appealIdParamSchema = z.coerce.number().int().positive();
export const appealStatusQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "all"]).default("all")
});
