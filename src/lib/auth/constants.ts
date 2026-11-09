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
 * The role of a signed-in account, or null when it has no valid role.
 *
 *  1. A role custom claim (set by `npm run set-role`) wins: "teacher"/"admin"
 *     → teacher, "student" → student.
 *  2. Without a claim, the `users/{uid}.role` profile field decides. Only the
 *     Admin SDK can write it (Firestore rules deny every client write).
 *  3. Anything else (no claim, missing or unknown profile role) → null: the
 *     account gets an access error and is never treated as a teacher.
 */
export function resolveRole(claimRole: unknown, profileRole: unknown): Role | null {
  if (typeof claimRole === "string") {
    if (TEACHER_CLAIMS.includes(claimRole)) return "teacher";
    if (claimRole === "student") return "student";
  }
  if (profileRole === "teacher" || profileRole === "student") return profileRole;
  return null;
}

/** Shown when a signed-in account has no valid role. */
export const NO_ROLE_MESSAGE = "This account does not have a valid role yet. Please contact the academy.";

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
