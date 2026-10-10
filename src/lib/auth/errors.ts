// Maps Firebase client error codes to friendly messages. Deliberately vague
// for credential errors so the UI does not reveal whether an account exists.

const messages: Record<string, string> = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/missing-password": "Please enter your password.",
  "auth/weak-password": "Please choose a stronger password (at least 8 characters).",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/user-disabled": "This account has been disabled. Please contact the academy.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/popup-blocked": "The sign-in popup was blocked. Please allow popups for this site and try again.",
  "auth/popup-closed-by-user": "The Google sign-in window was closed before finishing.",
  "auth/cancelled-popup-request": "The Google sign-in window was closed before finishing.",
  "auth/account-exists-with-different-credential":
    "An account already exists with this email. Sign in with your email and password instead.",
  "auth/operation-not-allowed": "This sign-in method is not enabled yet. Please contact the academy.",
  "auth/unauthorized-domain": "Sign-in is not enabled for this website address yet.",
  "firebase/not-configured": "Sign-in is not available yet. Please contact the academy.",
};

export function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const code = "code" in error && typeof error.code === "string" ? error.code : null;
    if (code && messages[code]) return messages[code];
    if (error instanceof Error && messages[error.message]) return messages[error.message];
    // Errors raised by our own session endpoint already carry a safe message.
    if (!code && error instanceof Error && error.message) return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** Popup dismissals are not worth showing as an error. */
export function isUserCancellation(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}
