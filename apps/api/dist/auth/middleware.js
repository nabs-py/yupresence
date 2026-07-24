import jwt from "jsonwebtoken";
import { roles } from "./types.js";
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET must be configured");
    }
    return secret;
}
function isAuthenticatedUser(payload) {
    return (typeof payload !== "string" &&
        typeof payload.user_id === "number" &&
        Number.isInteger(payload.user_id) &&
        typeof payload.role === "string" &&
        roles.includes(payload.role));
}
export function requireAuth(request, response, next) {
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
    }
    catch {
        response.status(401).json({ error: "Invalid or expired authentication token" });
    }
}
export function requireRole(...allowedRoles) {
    return (request, response, next) => {
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
