export const roles = ["student", "professor", "admin"] as const;

export type Role = (typeof roles)[number];

export interface AuthenticatedUser {
  user_id: number;
  role: Role;
  device_binding_required?: boolean;
}
