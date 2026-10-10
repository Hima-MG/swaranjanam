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

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? "Could not sign you in. Please try again.";
  } catch {
    return "Could not sign you in. Please try again.";
  }
}

/** Creates the server session and returns the URL to navigate to. */
async function establishSession(user: User, profile?: { displayName?: string; phone?: string }) {
  const auth = await getClientAuth();
  try {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ idToken, profile, next: nextFromUrl() }),
    });
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

export async function requestPasswordReset(email: string) {
  const auth = await getClientAuth();
  await sendPasswordResetEmail(auth, email.trim(), {
    url: `${window.location.origin}/login`,
  });
}

export async function logout() {
  await fetch("/api/auth/session", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  });
}
