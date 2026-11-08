// Unit tests for the production-readiness fixes:
//  * Razorpay Test Mode is fail-closed to emulator / explicitly listed non-production Firebase projects.
//  * Legacy four-class packages are read-only.
//  * The batch enrolment advance is non-refundable (only payment mistakes can be reversed).
//  * Enrolment never copies a catalogue price into agreedFee.
//  * Firestore rules pause direct lesson/course reads while billing access is suspended.
// Pure / static: no network, no Firebase, no Razorpay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { ADVANCE_CORRECTION_REASONS, ADVANCE_NON_REFUNDABLE, ADVANCE_STATUS_LABELS, advanceReversalError, PENDING_DECISIONS } from "../../src/lib/lms/class-billing.ts";
import { BLOCKED_PACKAGE_OPERATIONS, LEGACY_PACKAGES_READ_ONLY, legacyPackageBlock } from "../../src/lib/lms/legacy-packages.ts";
import { parseProjectList, paymentEnvironment, TEST_PROJECTS_ENV, testModeEnvironment } from "../../src/lib/payments/environment.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Razorpay Test Mode environment (fail-closed)", () => {
  test("emulator (demo-) projects are allowed", () => {
    assert.deepEqual(testModeEnvironment("demo-swaranjanam", ""), { allowed: true, projectId: "demo-swaranjanam" });
  });
  test("any other project is refused unless explicitly listed", () => {
    for (const list of [undefined, null, "", " ", "other-staging", "swaranjanam-staging,another"]) {
      assert.equal(testModeEnvironment("swaranjanam-prod", list).allowed, false, `list ${JSON.stringify(list)}`);
    }
  });
  test("an explicitly listed non-production project is allowed (exact match only)", () => {
    assert.equal(testModeEnvironment("swaranjanam-staging", "swaranjanam-staging").allowed, true);
    assert.equal(testModeEnvironment("swaranjanam-staging", " a-proj , swaranjanam-staging ").allowed, true);
    assert.equal(testModeEnvironment("swaranjanam-staging", "swaranjanam-stag").allowed, false);
    assert.equal(testModeEnvironment("swaranjanam", "swaranjanam-staging").allowed, false);
  });
  test("a missing project id is refused", () => {
    for (const id of [undefined, null, "", "  "]) assert.equal(testModeEnvironment(id, "demo-x,anything").allowed, false);
  });
  test("malformed list entries are ignored", () => {
    assert.deepEqual(parseProjectList("good-proj, BAD PROJ, ,x,ok-2"), ["good-proj", "ok-2"]);
  });
  test("the refusal reason names the setting but never a secret", () => {
    const r = testModeEnvironment("swaranjanam-prod", "");
    assert.equal(r.allowed, false);
    assert.match(r.reason, new RegExp(TEST_PROJECTS_ENV));
  });
  test("every Razorpay path checks the environment before using keys or recording a payment", () => {
    const razorpay = read("src/lib/payments/razorpay.ts");
    assert.match(razorpay, /readRazorpayConfig\(\)[\s\S]*assertPaymentEnvironment\(mode\);\s*return \{ mode, keyId/);
    const gateway = read("src/lib/lms/server/gateway.ts");
    assert.match(gateway, /processVerifiedGatewayPayment\([^)]*\)[^{]*\{\s*\/\/[^\n]*\n\s*const mode = requirePaymentMode\(\);/);
    // Orders and payments carry the mode they were made in; another mode never settles them.
    assert.match(gateway, /mode: config\.mode/);
    assert.match(gateway, /\(order\.mode \?\? "test"\) !== mode/);
    // The webhook and student actions go through readRazorpayConfig (which throws when refused).
    assert.match(read("src/app/api/payments/razorpay/webhook/route.ts"), /readRazorpayConfig\(\)/);
    assert.match(read("src/app/(account)/dashboard/payment-actions.ts"), /instanceof GatewayConfigError/);
  });
  test("no client component imports the Razorpay server module or reads secrets", () => {
    const button = read("src/components/lms/student/pay-online-button.tsx");
    assert.doesNotMatch(button, /lib\/payments\/razorpay"|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|process\.env/);
    assert.match(read("src/lib/payments/razorpay.ts"), /^import "server-only";/);
  });
});

describe("Razorpay Live Mode environment (fail-closed)", () => {
  test("live keys are allowed only on a real (non-test) Firebase project", () => {
    assert.deepEqual(paymentEnvironment("live", "swaranjanam-prod", ""), { allowed: true, projectId: "swaranjanam-prod" });
    assert.equal(paymentEnvironment("live", "swaranjanam-prod", "swaranjanam-staging").allowed, true);
  });
  test("live keys are refused on emulator, listed test projects and a missing project", () => {
    assert.equal(paymentEnvironment("live", "demo-swaranjanam", "").allowed, false);
    assert.equal(paymentEnvironment("live", "swaranjanam-staging", "swaranjanam-staging").allowed, false);
    for (const id of [undefined, null, "", " "]) assert.equal(paymentEnvironment("live", id, "").allowed, false);
  });
  test("test keys keep the Test Mode rules", () => {
    assert.equal(paymentEnvironment("test", "swaranjanam-prod", "").allowed, false);
    assert.equal(paymentEnvironment("test", "demo-x", "").allowed, true);
  });
});

describe("legacy packages are read-only", () => {
  test("creating, activating, adjusting, paying into and scheduling against packages is blocked", () => {
    assert.equal(LEGACY_PACKAGES_READ_ONLY, true);
    for (const op of BLOCKED_PACKAGE_OPERATIONS) assert.ok(legacyPackageBlock(op), op);
    assert.deepEqual([...BLOCKED_PACKAGE_OPERATIONS].sort(), ["activate", "adjust", "create", "record_payment", "schedule_class"]);
  });
  test("viewing, cancelling and correcting existing payment statuses stay available", () => {
    for (const op of ["view", "cancel", "correct_payment_status"]) assert.equal(legacyPackageBlock(op), null, op);
  });
  test("each blocked server action checks the guard right after the role check", () => {
    const billing = read("src/app/(account)/teacher/billing-actions.ts");
    for (const [action, op] of [["createPackage", "create"], ["activatePackage", "activate"], ["recordAdjustment", "adjust"]]) {
      assert.match(
        billing,
        new RegExp(`runAction\\("${action}", async \\(\\) => \\{\\s*const user = await requireActionUser\\("teacher"\\);\\s*const blocked = legacyPackageBlock\\("${op}"\\);\\s*if \\(blocked\\) throw new AccessError\\(blocked\\);`),
        action,
      );
    }
    assert.match(read("src/app/(account)/teacher/class-actions.ts"), /legacyPackageBlock\("schedule_class"\)/);
    assert.match(read("src/app/(account)/teacher/payment-actions.ts"), /packageId \? legacyPackageBlock\("record_payment"\)/);
  });
  test("the teacher screens no longer offer new package activity", () => {
    for (const page of ["src/app/(account)/teacher/packages/page.tsx", "src/app/(account)/teacher/students/[studentId]/page.tsx", "src/app/(account)/teacher/packages/[packageId]/page.tsx"]) {
      const src = read(page);
      assert.doesNotMatch(src, /AssignPackageDialog|ActivatePackageDialog|AdjustmentDialog/, page);
    }
  });
});

describe("batch enrolment advance is non-refundable", () => {
  test("the policy is explicit and no longer an open decision", () => {
    assert.equal(ADVANCE_NON_REFUNDABLE, true);
    assert.equal(PENDING_DECISIONS.some((d) => d.key === "leaving"), false);
    assert.equal(ADVANCE_STATUS_LABELS.refunded, "Reversed (payment error)");
  });
  test("an advance can only be reversed to correct a payment mistake", () => {
    for (const reason of [undefined, null, "", "student_left", "refund", "goodwill"]) {
      assert.match(advanceReversalError({ reason, appliedMinor: 0 }), /non-refundable/, String(reason));
    }
    for (const reason of ADVANCE_CORRECTION_REASONS) assert.equal(advanceReversalError({ reason, appliedMinor: 0 }), null, reason);
  });
  test("an initial payment already deducted on a monthly invoice cannot be reversed at all", () => {
    assert.match(advanceReversalError({ reason: "duplicate_payment", appliedMinor: 40_000 }), /already been deducted/);
  });
  test("the server action enforces it and records the reversal in the advance ledger", () => {
    const src = read("src/app/(account)/teacher/payment-actions.ts");
    assert.match(src, /advanceReversalError\(\{ reason: correctionReason, appliedMinor \}\)/);
    assert.match(src, /kind: "reversed"/);
  });
  test("students are told the advance is non-refundable", () => {
    assert.match(read("src/app/(account)/dashboard/billing/page.tsx"), /non-refundable/);
  });
});

describe("enrolment never invents a fee", () => {
  test("a new enrollment stores agreedFee: null, never the catalogue price", () => {
    const src = read("src/app/(account)/teacher/actions.ts");
    const create = src
      .slice(src.indexOf("tx.create(ref, {"), src.indexOf("return \"created\" as const;"))
      .replace(/\/\/[^\n]*/g, "");
    assert.match(create, /agreedFee: null,/);
    assert.doesNotMatch(create, /course\.price/);
  });
});

describe("Firestore rules respect billing suspension", () => {
  const rules = read("firestore.rules");
  test("direct reads require no suspended batch or individual account for the course", () => {
    assert.match(rules, /\$\("ba_" \+ request\.auth\.uid \+ "_" \+ courseId \+ "_" \+ mode\)/);
    const enrolled = rules.slice(rules.indexOf("function enrolledIn"), rules.indexOf("match /users"));
    assert.match(enrolled, /!suspendedAccount\(courseId, "batch"\)/);
    assert.match(enrolled, /!suspendedAccount\(courseId, "individual"\)/);
  });
  test("rules still deny every client write", () => {
    assert.doesNotMatch(rules, /allow (create|update|delete|write): if (?!false)/);
  });
});
