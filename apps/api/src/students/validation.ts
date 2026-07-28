import { z } from "zod";

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(72),
  new_password: z.string().min(8).max(72)
});

export const registerDeviceSchema = z.object({
  device_id: z.string().trim().min(16).max(255)
});

export const deviceChangeRequestSchema = z.object({
  reason: z.string().trim().min(1).max(2_000)
});
