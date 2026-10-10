import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";

import { sanitizeNextPath } from "@/lib/auth/constants";
import { getClientAuth } from "@/lib/firebase/client";

// Browser-side auth flows. Each sign-in exchanges the Firebase ID token for a
// server session cookie, then signs the client SDK out again.

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

function nextFromUrl(): string | null {
  return sanitizeNextPath(new URLSearchParams(window.location.search).get("next"));
}

/**
 * Turns a failed session request into a message for the login form. Only
 * fixed, user-facing text is shown — never raw server output.
 */
async function readError(response: Response): Promise<string> {
  switch (response.status) {
    case 401: {
      // The server sends a short, safe explanation (expired or stale sign-in).
      const fallback = "Your sign-in could not be verified. Please try again.";
      try {
        const data = (await response.json()) as { error?: unknown };
        return typeof data.error === "string" && data.error.length < 120 ? data.error : fallback;
      } catch {
        return fallback;
      }
    }
    case 403:
      return "Your browser blocked the sign-in request. Open the site from its usual address, reload the page and try again.";
    case 503:
      return "Sign-in is temporarily unavailable. Please try again later or contact the academy.";
    default:
      return "Could not sign you in. Please try again.";
  }
}

/** Creates the server session and returns the URL to navigate to. */
async function establishSession(user: User, profile?: { displayName?: string; phone?: string }) {
  const auth = await getClientAuth();
  try {
    const idToken = await user.getIdToken();
    let response: Response;
    try {
      response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ idToken, profile, next: nextFromUrl() }),
      });
    } catch {
      throw new Error("Network error. Check your connection and try again.");
    }
    if (!response.ok) throw new Error(await readError(response));
    const { redirectTo } = (await response.json()) as { redirectTo: string };
    return redirectTo;
  } finally {
    // The HttpOnly cookie is now the only credential; drop the client copy.
    await signOut(auth).catch(() => undefined);
  }
}

export async function loginWithEmail(email: string, password: string) {
  const auth = await getClientAuth();
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  return establishSession(user);
}

export async function registerWithEmail(input: RegisterInput) {
  const auth = await getClientAuth();
  const { user } = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password);
  const displayName = input.name.trim();
  if (displayName) await updateProfile(user, { displayName });
  return establishSession(user, { displayName, phone: input.phone?.trim() });
}

export async function loginWithGoogle() {
  const auth = await getClientAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const { user } = await signInWithPopup(auth, provider);
  return establishSession(user);
}

const CONTINUE_URL_ERRORS = new Set([
  "auth/unauthorized-continue-uri",
  "auth/invalid-continue-uri",
  "auth/missing-continue-uri",
]);

/**
 * Sends Firebase's password-reset email. The link returns the user to /login
 * when this site's domain is an authorised domain in Firebase; otherwise the
 * request is retried without a return link (Firebase's own page still lets
 * the user set a new password). Nothing is logged.
 */
export async function requestPasswordReset(email: string) {
  const auth = await getClientAuth();
  try {
    await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/login` });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (!CONTINUE_URL_ERRORS.has(code)) throw error;
    await sendPasswordResetEmail(auth, email.trim());
  }
}

export async function logout() {
  await fetch("/api/auth/session", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  });
}
