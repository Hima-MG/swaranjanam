// Which Firebase project may record Razorpay TEST MODE payments. FAIL-CLOSED.
//
// A Test Mode payment is not real money. If it were recorded in the production
// database it would clear real invoices, mark sessions paid, issue receipts and
// lift access suspensions. So Test Mode is allowed ONLY when the server's
// Firebase project is:
//   * an emulator project (id starts with "demo-"; these can never reach real
//     Firebase), or
//   * listed explicitly in RAZORPAY_TEST_FIREBASE_PROJECTS (comma-separated),
//     e.g. a separate staging project. Never list the production project.
// Anything else — including a missing project id or an empty list — disables
// online payments (orders, checkout confirmation and the webhook).
//
// PURE module (no secrets, no I/O): unit-tested.

export const TEST_PROJECTS_ENV = "RAZORPAY_TEST_FIREBASE_PROJECTS";

export type PaymentEnvironment = { allowed: true; projectId: string } | { allowed: false; reason: string };

export function parseProjectList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^[a-z0-9-]{4,40}$/.test(p));
}

/** Decides whether Razorpay Test Mode payments may be recorded for this Firebase project. */
export function testModeEnvironment(projectId: string | undefined | null, allowList: string | undefined | null): PaymentEnvironment {
  const id = (projectId ?? "").trim();
  if (!id) return { allowed: false, reason: "The server's Firebase project is not configured." };
  if (id.startsWith("demo-")) return { allowed: true, projectId: id };
  if (parseProjectList(allowList).includes(id)) return { allowed: true, projectId: id };
  return {
    allowed: false,
    reason: `Razorpay Test Mode is not allowed for this Firebase project. Add it to ${TEST_PROJECTS_ENV} only if it is a non-production (test or staging) project.`,
  };
}

export type RazorpayMode = "test" | "live";

/**
 * Decides whether payments of this Razorpay mode may be recorded here. FAIL-CLOSED.
 *  * test → only an emulator or explicitly listed non-production project (above);
 *  * live → only a REAL project: never an emulator project and never a project
 *    listed as a test project (real money must land in the production database,
 *    and test projects never hold real payments).
 */
export function paymentEnvironment(mode: RazorpayMode, projectId: string | undefined | null, allowList: string | undefined | null): PaymentEnvironment {
  if (mode === "test") return testModeEnvironment(projectId, allowList);
  const id = (projectId ?? "").trim();
  if (!id) return { allowed: false, reason: "The server's Firebase project is not configured." };
  if (id.startsWith("demo-") || parseProjectList(allowList).includes(id)) {
    return { allowed: false, reason: `Razorpay Live Mode keys cannot be used with a test Firebase project (emulator or listed in ${TEST_PROJECTS_ENV}). Use rzp_test_ keys here.` };
  }
  return { allowed: true, projectId: id };
}
