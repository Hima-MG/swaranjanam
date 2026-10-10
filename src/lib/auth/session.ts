import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { ROLE_HOME, SESSION_COOKIE_NAME, TEACHER_CLAIMS, type Role } from "@/lib/auth/constants";
import { AdminConfigError, getAdminAuth } from "@/lib/firebase/admin";

export interface SessionUser {
  uid: string;
  email: string | null;
  name: string | null;
  role: Role;
}

/** Firebase allows session cookies between 5 minutes and 14 days. */
const MIN_DAYS = 1;
const MAX_DAYS = 14;
const DEFAULT_DAYS = 5;
/** A sign-in must be this recent to be exchanged for a session cookie. */
const MAX_SIGN_IN_AGE_SECONDS = 5 * 60;

export function getSessionMaxAgeMs(): number {
  const parsed = Number.parseInt(process.env.SESSION_COOKIE_MAX_AGE_DAYS ?? "", 10);
  const days = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, MIN_DAYS), MAX_DAYS)
    : DEFAULT_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/** Role comes only from the custom claim, which only trusted server code can set. */
export function roleFromClaims(claims: DecodedIdToken): Role {
  return typeof claims.role === "string" && TEACHER_CLAIMS.includes(claims.role)
    ? "teacher"
    : "student";
}

function toSessionUser(claims: DecodedIdToken): SessionUser {
  return {
    uid: claims.uid,
    email: claims.email ?? null,
    name: typeof claims.name === "string" ? claims.name : null,
    role: roleFromClaims(claims),
  };
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * Exchanges a freshly issued Firebase ID token for a session cookie.
 * Revoked or stale sign-ins are rejected.
 */
export async function createSessionCookie(idToken: string) {
  const auth = getAdminAuth();
  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch {
    throw new SessionError("Invalid or expired sign-in. Please try again.", 401);
  }

  const signInAgeSeconds = Date.now() / 1000 - decoded.auth_time;
  if (signInAgeSeconds > MAX_SIGN_IN_AGE_SECONDS) {
    throw new SessionError("Please sign in again to continue.", 401);
  }

  const expiresIn = getSessionMaxAgeMs();
  const cookie = await auth.createSessionCookie(idToken, { expiresIn });
  return { cookie, expiresIn, decoded, user: toSessionUser(decoded) };
}

/**
 * Verifies the session cookie for this request.
 *
 * - `strict` (default) also checks revocation and disabled accounts with a
 *   call to Firebase — use for protected pages and every sensitive operation.
 * - `strict: false` verifies signature and expiry locally — enough for
 *   cosmetic UI such as the navbar.
 *
 * Returns null for missing, expired, revoked or malformed sessions. Missing
 * Admin configuration is re-thrown so misconfiguration is not silently
 * treated as "logged out" on protected routes.
 */
export const getSession = cache(async (strict: boolean = true): Promise<SessionUser | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;

  try {
    const claims = await getAdminAuth().verifySessionCookie(cookie, strict);
    return toSessionUser(claims);
  } catch (error) {
    if (error instanceof AdminConfigError) throw error;
    return null;
  }
});

function loginUrl(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

/** For Server Components and Server Actions: redirect to login when signed out. */
export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getSession(true);
  if (!user) redirect(loginUrl(nextPath));
  return user;
}

/**
 * For Server Components and Server Actions: requires a session with exactly
 * this role. Users with the other role are sent to their own home instead.
 */
export async function requireRole(role: Role, nextPath: string): Promise<SessionUser> {
  const user = await requireUser(nextPath);
  if (user.role !== role) redirect(ROLE_HOME[user.role]);
  return user;
}

/**
 * For Route Handlers: returns the user or a ready-made error response.
 * Never redirects, so API clients get proper 401/403 status codes.
 */
export async function authorizeRequest(
  role?: Role,
): Promise<{ user: SessionUser; response?: never } | { user?: never; response: Response }> {
  const user = await getSession(true);
  if (!user) {
    return { response: Response.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (role && user.role !== role) {
    return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}
