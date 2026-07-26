import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Request } from "express";

const rateLimitMessage = { error: "Too many requests. Please try again later." };

function authenticatedUserKey(request: Request): string {
  // These limiters run after requireAuth, so classroom users sharing an IP do
  // not consume each other's allowance.
  return `user:${request.user?.user_id ?? "unknown"}`;
}

function loginAttemptKey(request: Request): string {
  const rawEmail = typeof request.body?.email === "string" ? request.body.email : "unknown";
  const email = rawEmail.trim().toLowerCase().slice(0, 255) || "unknown";
  const address = ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? "unknown");

  // The account component prevents one student on a shared classroom/hotspot
  // address from consuming another student's login allowance.
  return `login:${address}:${email}`;
}

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: loginAttemptKey,
  standardHeaders: false,
  legacyHeaders: false,
  message: rateLimitMessage
});

export const scanRateLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  limit: 15,
  keyGenerator: authenticatedUserKey,
  standardHeaders: false,
  legacyHeaders: false,
  message: rateLimitMessage
});

export const signupRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: authenticatedUserKey,
  standardHeaders: false,
  legacyHeaders: false,
  message: rateLimitMessage
});
