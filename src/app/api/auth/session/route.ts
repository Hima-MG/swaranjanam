import { cookies } from "next/headers";

import { ROLE_HOME, SESSION_COOKIE_NAME, sanitizeNextPath } from "@/lib/auth/constants";
import { rejectCrossSiteRequest } from "@/lib/auth/csrf";
import { ensureUserProfile } from "@/lib/auth/profile";
import { createSessionCookie, getSession, SessionError } from "@/lib/auth/session";
import { AdminConfigError, getAdminAuth } from "@/lib/firebase/admin";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

interface CreateSessionBody {
  idToken?: unknown;
  /** Optional profile details collected by the registration form. */
  profile?: { displayName?: unknown; phone?: unknown };
  next?: unknown;
}

function configErrorResponse(error: unknown) {
  // Log the error class and message only — never request data or credentials.
  console.error("[auth] Firebase Admin is not configured:", (error as Error).message);
  return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
}

/** Exchange a fresh Firebase ID token for an HttpOnly session cookie. */
export async function POST(request: Request) {
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return rejected;

  let body: CreateSessionBody;
  try {
    body = (await request.json()) as CreateSessionBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.idToken !== "string" || body.idToken.length === 0 || body.idToken.length > 4096) {
    return Response.json({ error: "Missing ID token" }, { status: 400 });
  }

  try {
    const { cookie, expiresIn, decoded, user } = await createSessionCookie(body.idToken);

    // First sign-in creates a student profile. The role is never read from the body.
    await ensureUserProfile({
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: body.profile?.displayName ?? decoded.name,
      phone: body.profile?.phone,
      provider: decoded.firebase.sign_in_provider,
    });

    (await cookies()).set(SESSION_COOKIE_NAME, cookie, {
      ...cookieOptions,
      maxAge: Math.floor(expiresIn / 1000),
    });

    // Only honour `next` when it points inside the user's own area.
    const home = ROLE_HOME[user.role];
    const next = sanitizeNextPath(typeof body.next === "string" ? body.next : null);
    const redirectTo = next && (next === home || next.startsWith(`${home}/`)) ? next : home;

    return Response.json({ redirectTo, role: user.role });
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AdminConfigError) return configErrorResponse(error);
    console.error("[auth] Failed to create session:", (error as Error).name);
    return Response.json({ error: "Could not sign you in. Please try again." }, { status: 500 });
  }
}

/** Log out: clear the cookie and revoke the user's refresh tokens. */
export async function DELETE(request: Request) {
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return rejected;

  const cookieStore = await cookies();
  try {
    // Lenient check: an expired cookie should still be clearable.
    const user = await getSession(false);
    if (user) {
      // Invalidates this and every other session for the account, because
      // strict verification checks the revocation time.
      await getAdminAuth().revokeRefreshTokens(user.uid);
    }
  } catch (error) {
    if (!(error instanceof AdminConfigError)) {
      console.error("[auth] Failed to revoke tokens:", (error as Error).name);
    }
  } finally {
    cookieStore.delete({ name: SESSION_COOKIE_NAME, path: "/" });
  }

  return Response.json({ ok: true });
}
