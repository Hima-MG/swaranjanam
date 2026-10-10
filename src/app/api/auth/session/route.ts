import { cookies } from "next/headers";

import { ROLE_HOME, SESSION_COOKIE_NAME, sanitizeNextPath } from "@/lib/auth/constants";
import { rejectCrossSiteRequest } from "@/lib/auth/csrf";
import { authLog, describeError } from "@/lib/auth/diagnostics";

// Firebase Admin is loaded inside the handlers (not at module top level): if
// the Admin SDK cannot be loaded in a deployment, the failure is caught,
// logged with its cause and answered with a clear 503 — instead of the whole
// route crashing with an empty 500.
async function loadAuthServer() {
  const [session, profile, admin] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/auth/profile"),
    import("@/lib/firebase/admin"),
  ]);
  return { ...session, ...profile, ...admin };
}

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

const unavailable = () => Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });

/** Exchange a fresh Firebase ID token for an HttpOnly session cookie. */
export async function POST(request: Request) {
  authLog("session.create", "start");
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) {
    authLog("session.create", "rejected", { status: rejected.status });
    return rejected;
  }

  let body: CreateSessionBody;
  try {
    body = (await request.json()) as CreateSessionBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.idToken !== "string" || body.idToken.length === 0 || body.idToken.length > 4096) {
    return Response.json({ error: "Missing ID token" }, { status: 400 });
  }

  let server: Awaited<ReturnType<typeof loadAuthServer>>;
  try {
    server = await loadAuthServer();
  } catch (error) {
    authLog("session.create", "admin-sdk-load-failed", describeError(error), "error");
    return unavailable();
  }
  const { createSessionCookie, ensureUserProfile, SessionError, AdminConfigError } = server;

  let stage = "verify-token";
  try {
    const { cookie, expiresIn, decoded, user } = await createSessionCookie(body.idToken);
    authLog("session.create", "token-verified", { provider: decoded.firebase.sign_in_provider, role: user.role });

    // First sign-in creates a student profile. The role is never read from the body.
    stage = "ensure-profile";
    await ensureUserProfile({
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: body.profile?.displayName ?? decoded.name,
      phone: body.profile?.phone,
      provider: decoded.firebase.sign_in_provider,
    });

    stage = "set-cookie";
    (await cookies()).set(SESSION_COOKIE_NAME, cookie, {
      ...cookieOptions,
      maxAge: Math.floor(expiresIn / 1000),
    });

    // Only honour `next` when it points inside the user's own area.
    const home = ROLE_HOME[user.role];
    const next = sanitizeNextPath(typeof body.next === "string" ? body.next : null);
    const redirectTo = next && (next === home || next.startsWith(`${home}/`)) ? next : home;

    authLog("session.create", "ok", { role: user.role, redirectTo });
    return Response.json({ redirectTo, role: user.role });
  } catch (error) {
    if (error instanceof SessionError) {
      authLog("session.create", "refused", { at: stage, status: error.status }, "warn");
      return Response.json({ error: error.message }, { status: error.status });
    }
    authLog("session.create", "failed", { at: stage, ...describeError(error) }, "error");
    if (error instanceof AdminConfigError) return unavailable();
    return Response.json({ error: "Could not sign you in. Please try again." }, { status: 500 });
  }
}

/** Log out: clear the cookie and revoke the user's refresh tokens. */
export async function DELETE(request: Request) {
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return rejected;

  const cookieStore = await cookies();
  try {
    const { getSession, getAdminAuth } = await loadAuthServer();
    // Lenient check: an expired cookie should still be clearable.
    const user = await getSession(false);
    if (user) {
      // Invalidates this and every other session for the account, because
      // strict verification checks the revocation time.
      await getAdminAuth().revokeRefreshTokens(user.uid);
    }
    authLog("session.delete", "ok", { hadSession: Boolean(user) });
  } catch (error) {
    authLog("session.delete", "revoke-failed", describeError(error), "error");
  } finally {
    // Always clear the cookie, even if revocation failed.
    cookieStore.delete({ name: SESSION_COOKIE_NAME, path: "/" });
  }

  return Response.json({ ok: true });
}
