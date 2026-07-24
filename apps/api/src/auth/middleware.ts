import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

import { roles, type AuthenticatedUser, type Role } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET must be configured");
  }

  return secret;
}

function isAuthenticatedUser(payload: string | JwtPayload): payload is JwtPayload & AuthenticatedUser {
  return (
    typeof payload !== "string" &&
    typeof payload.user_id === "number" &&
    Number.isInteger(payload.user_id) &&
    typeof payload.role === "string" &&
    roles.includes(payload.role as Role)
  );
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;

  if (!token) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());

    if (!isAuthenticatedUser(payload)) {
      response.status(401).json({ error: "Invalid authentication token" });
      return;
    }

    request.user = { user_id: payload.user_id, role: payload.role };
    next();
  } catch {
    response.status(401).json({ error: "Invalid or expired authentication token" });
  }
}

export function requireRole(...allowedRoles: Role[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!allowedRoles.includes(request.user.role)) {
      response.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
