import { connection } from "next/server";

import { authLog, describeError } from "@/lib/auth/diagnostics";

/**
 * Deployment check for the server-side auth stack. Loads the Firebase Admin
 * SDK and initialises it from environment variables (no network calls, no
 * user data). The response says only which stage failed; the cause is
 * written to the runtime logs. Safe to remove once production is healthy.
 */
export async function GET() {
  // Run on every request: a build-time result would not test the deployed runtime.
  await connection();
  const stages: [string, () => Promise<unknown>][] = [
    ["load firebase-admin/app", () => import("firebase-admin/app")],
    ["load firebase-admin/auth", () => import("firebase-admin/auth")],
    ["load firebase-admin/firestore", () => import("firebase-admin/firestore")],
    ["init admin app", async () => (await import("@/lib/firebase/admin")).getAdminAuth()],
  ];

  for (const [stage, run] of stages) {
    try {
      await run();
    } catch (error) {
      authLog("health", "failed", { at: stage, ...describeError(error) }, "error");
      return Response.json({ ok: false, failedStage: stage }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
