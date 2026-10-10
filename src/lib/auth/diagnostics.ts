import "server-only";

// Safe, structured logging for authentication stages (visible in Vercel's
// runtime logs). Only stage names and non-sensitive facts are logged —
// never ID tokens, session cookies, passwords, private keys or emails.

type Level = "info" | "warn" | "error";
type Details = Record<string, string | number | boolean | null | undefined>;

export function authLog(flow: string, stage: string, details: Details = {}, level: Level = "info") {
  const line = JSON.stringify({ scope: "auth", flow, stage, ...details });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/**
 * Error name, Firebase error code and a shortened message. Messages from the
 * Admin SDK and module loader name the failing module or Firebase code; they
 * do not contain tokens or keys, but are truncated and stripped of anything
 * token-shaped as a precaution.
 */
export function describeError(error: unknown): Details {
  const err = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  const message = typeof err?.message === "string" ? err.message : String(error);
  return {
    errorName: typeof err?.name === "string" ? err.name : typeof error,
    errorCode: typeof err?.code === "string" ? err.code : undefined,
    errorMessage: message
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
      .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, "[key]")
      .slice(0, 300),
  };
}
