export const authRoles = ["student", "professor", "admin"] as const;

export type AuthRole = (typeof authRoles)[number];

export interface AuthSession {
  token: string;
  role: AuthRole;
}

interface TokenPayload {
  exp?: unknown;
  role?: unknown;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  return globalThis.atob(padded);
}

export function decodeAuthSession(token: string): AuthSession | null {
  try {
    const payloadSegment = token.split(".")[1];

    if (!payloadSegment) {
      return null;
    }

    const payload = JSON.parse(decodeBase64Url(payloadSegment)) as TokenPayload;
    const isRole = typeof payload.role === "string" && authRoles.includes(payload.role as AuthRole);
    const expiresAt = typeof payload.exp === "number" ? payload.exp * 1000 : undefined;

    if (!isRole || (expiresAt !== undefined && expiresAt <= Date.now())) {
      return null;
    }

    return { token, role: payload.role as AuthRole };
  } catch {
    return null;
  }
}
