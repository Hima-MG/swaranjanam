// Legacy prepaid class packages (the earlier four-class model) are READ-ONLY.
//
// Website billing from November 2026 uses four-week cycles for batch classes and per
// session for individual classes (lib/lms/class-billing.ts). Existing package
// records, payments and receipts are kept unchanged as history and stay
// visible. No new package activity is allowed: creating or activating a
// package, adjusting it, recording a new payment against it, or scheduling a
// new class that uses its credits. Cancelling a package and correcting the
// status of an already-recorded payment remain available for clean-up.
//
// PURE module: safe in Server and Client Components, unit-tested.

export const LEGACY_PACKAGES_READ_ONLY = true;

export const LEGACY_PACKAGES_MESSAGE =
  "Class packages are a legacy billing method and are now read-only. Batch classes are billed in four-week cycles and individual sessions per session (Billing).";

/** The package operations that are blocked while packages are read-only. */
export const BLOCKED_PACKAGE_OPERATIONS = ["create", "activate", "adjust", "record_payment", "schedule_class"] as const;
export type PackageOperation = (typeof BLOCKED_PACKAGE_OPERATIONS)[number] | "cancel" | "correct_payment_status" | "view";

/** Null when the operation is allowed, otherwise the message to show. */
export function legacyPackageBlock(operation: PackageOperation): string | null {
  if (!LEGACY_PACKAGES_READ_ONLY) return null;
  return (BLOCKED_PACKAGE_OPERATIONS as readonly string[]).includes(operation) ? LEGACY_PACKAGES_MESSAGE : null;
}
