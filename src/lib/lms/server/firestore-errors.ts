import "server-only";

import { AdminConfigError } from "@/lib/firebase/admin";

// Turns a Firestore / Admin SDK failure into a short, safe explanation for the
// academy administrator, plus a log line for the server logs (Vercel → Logs).
// Never includes credentials, document data or stack traces.

export interface DescribedError {
  /** Stable label, e.g. "permission-denied" — also written to the server log. */
  code: string;
  /** What the administrator can do about it. */
  message: string;
}

const GRPC: Record<number, string> = {
  4: "deadline-exceeded",
  5: "not-found",
  7: "permission-denied",
  8: "resource-exhausted",
  9: "failed-precondition",
  13: "internal",
  14: "unavailable",
  16: "unauthenticated",
};

function codeOf(error: unknown): string {
  if (error instanceof AdminConfigError) return "admin-config";
  const raw = (error as { code?: unknown })?.code;
  if (typeof raw === "number") return GRPC[raw] ?? `grpc-${raw}`;
  if (typeof raw === "string") return raw.replace(/^(firestore|app|auth)\//, "");
  return (error as Error)?.name || "unknown";
}

export function describeFirestoreError(error: unknown): DescribedError {
  const code = codeOf(error);
  switch (code) {
    case "admin-config":
      return {
        code,
        message:
          "The server's Firebase Admin settings are missing or invalid (FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY). Check them in Vercel → Settings → Environment Variables and redeploy.",
      };
    case "permission-denied":
    case "unauthenticated":
      return {
        code,
        message:
          "The server's Firebase service account is not allowed to read Firestore. Check that the service account key in Vercel belongs to the same Firebase project as the website and still exists (Firebase console → Project settings → Service accounts).",
      };
    case "resource-exhausted":
      return {
        code,
        message: "Firestore's usage quota for the project has been reached. Check Firebase console → Usage and billing; reads resume when the quota resets or the plan is upgraded.",
      };
    case "not-found":
      return {
        code,
        message: "The Firestore database could not be found for the configured Firebase project. Check FIREBASE_ADMIN_PROJECT_ID in Vercel and that Firestore is enabled for that project.",
      };
    case "failed-precondition":
      return { code, message: "Firestore refused the query (an index may be missing). The server log has the details and the index link." };
    case "deadline-exceeded":
    case "unavailable":
    case "internal":
      return { code, message: "Firestore did not respond in time. This is usually temporary — please try again in a moment." };
    default:
      return { code, message: "The academy records could not be read. The server log has the details." };
  }
}

/** Logs a read failure with its classified code and message (no data, no secrets). */
export function logReadFailure(scope: string, error: unknown): DescribedError {
  const described = describeFirestoreError(error);
  console.error(`[${scope}] read failed`, JSON.stringify({ code: described.code, name: (error as Error)?.name, message: (error as Error)?.message?.slice(0, 500) }));
  return described;
}
