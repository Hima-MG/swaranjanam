// Shared between the server, the proxy and client components. Contains no secrets.

/** The only roles in the system. Absence of a teacher claim means "student". */
export const ROLES = ["student", "teacher"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Custom-claim values that grant the teacher role. `admin` is accepted for
 * accounts promoted before the role was renamed; new grants use `teacher`.
 */
export const TEACHER_CLAIMS: readonly string[] = ["teacher", "admin"];

/**
 * HttpOnly session cookie name. `__session` is the one cookie name Firebase
 * Hosting forwards, which keeps that deployment option open.
 */
export const SESSION_COOKIE_NAME = "__session";

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  student: "/dashboard",
  teacher: "/teacher",
};

/**
 * Accept only same-site relative paths for post-login redirects, preventing
 * open redirects such as `?next=//evil.example` or `?next=https://…`.
 */
export function sanitizeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  return value;
}
