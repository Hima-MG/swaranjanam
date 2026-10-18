// Unit tests for package, payment, class-credit, ownership and report rules
// (src/lib/lms/billing.ts).
//
// PURE unit tests: they exercise the same functions the Server Actions call
// inside their Firestore transactions, plus an in-memory simulation of the
// credit ledger. They do NOT run against Firestore and do NOT prove end-to-end
// authorisation; real-account checks are listed in the final report.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { toCsv } from "../../src/lib/csv.ts";
import {
  buildPackageDraft,
  canViewLearnerRecord,
  canViewPayment,
  countsAsReceived,
  creditLedgerId,
  creditsAvailableToSchedule,
  formatReceiptNumber,
  istPeriod,
  maskReference,
  nextPayment,
  normalizeReference,
  outcomeCredit,
  PACKAGE_REPORT_HEADERS,
  packageIdFor,
  packageReportRow,
  PAYMENT_REPORT_HEADERS,
  paymentReportRow,
  PUBLISHED_PLANS,
  revenueByPeriod,
  schedulingBlock,
  snapshotPlan,
  statusAfterConsumption,
  statusAfterPayment,
  summarizePackage,
  toStudentPayment,
} from "../../src/lib/lms/billing.ts";

const plan = (id) => snapshotPlan(PUBLISHED_PLANS.find((x) => x.id === id));
const learner = (studentId, category, name = studentId) => ({ studentId, category, name });

// --- Packages -----------------------------------------------------------------------

describe("packages", () => {
  test("price snapshot is a copy: later fee changes never alter an existing package", () => {
    const livePlan = plan("swara-foundation");
    const built = buildPackageDraft(livePlan, "regular", [learner("s1", "adult")]);
    assert.equal(built.ok, true);
    const { draft } = built;
    // The teacher raises the fees afterwards.
    livePlan.adultPriceMinor = 999_900;
    livePlan.pairPricesMinor.two_adults = 1;
    livePlan.sessionsIncluded = 10;
    assert.equal(draft.priceMinor, 160_000);
    assert.equal(draft.plan.adultPriceMinor, 160_000);
    assert.equal(draft.plan.pairPricesMinor.two_adults, 288_000);
    assert.equal(draft.sessionsIncluded, 4);
    // A new package uses the new fee.
    assert.equal(buildPackageDraft(livePlan, "regular", [learner("s1", "adult")]).draft.priceMinor, 999_900);
  });

  test("retrying with the same request key targets the same package id (idempotent create)", () => {
    const key = "3f6c2a9e-41b8-4d2e-9a77-0c1d2e3f4a5b";
    assert.equal(packageIdFor(key), packageIdFor(key));
    assert.equal(packageIdFor(key), `pkg_${key}`);
    assert.notEqual(packageIdFor(key), packageIdFor("aaaaaaaa-41b8-4d2e-9a77-0c1d2e3f4a5b"));
    for (const bad of ["", "short", "../../etc/passwd", "x".repeat(65), null, 42]) assert.equal(packageIdFor(bad), null, String(bad));
  });

  test("initial credits: 4 for a regular package, 6 for Voice Culture, 4 shared by a pair", () => {
    assert.equal(buildPackageDraft(plan("devotional-music"), "regular", [learner("s1", "student")]).draft.sessionsIncluded, 4);
    assert.equal(buildPackageDraft(plan("voice-culture"), "program", [learner("s1", "adult")]).draft.sessionsIncluded, 6);
    const pair = buildPackageDraft(plan("swara-foundation"), "pair", [learner("a", "adult"), learner("b", "student")]);
    assert.equal(pair.draft.sessionsIncluded, 4);
    assert.equal(pair.draft.priceMinor, 279_000);
  });

  test("pair learners are two distinct, linked students with their own categories", () => {
    const pair = buildPackageDraft(plan("devotional-music"), "pair", [learner("a", "adult", "Asha"), learner("b", "student", "Bala")]);
    assert.deepEqual(pair.draft.learnerIds, ["a", "b"]);
    assert.deepEqual(pair.draft.learners.map((l) => [l.studentId, l.category]), [["a", "adult"], ["b", "student"]]);
    assert.equal(buildPackageDraft(plan("devotional-music"), "pair", [learner("a", "adult"), learner("a", "student")]).ok, false);
  });

  test("learner ids are validated", () => {
    assert.equal(buildPackageDraft(plan("swara-foundation"), "regular", [learner("../x", "adult")]).ok, false);
  });

  test("coming-soon plans cannot be turned into packages", () => {
    assert.equal(buildPackageDraft(plan("geetha-pathway"), "regular", [learner("s1", "adult")]).ok, false);
    assert.equal(buildPackageDraft(plan("kriti-varnam-pathway"), "regular", [learner("s1", "student")]).ok, false);
  });
});

describe("package balances and statuses", () => {
  const paid = (amountMinor) => ({ amountMinor, status: "paid", verified: true });
  const base = { priceMinor: 160_000, sessionsIncluded: 4, creditsUsed: 0, adjustments: [] };

  test("unpaid, partly paid and fully paid", () => {
    assert.equal(summarizePackage({ ...base, payments: [] }).paymentState, "unpaid");
    const partial = summarizePackage({ ...base, payments: [paid(60_000)] });
    assert.equal(partial.paymentState, "partial");
    assert.equal(partial.balanceMinor, 100_000);
    const full = summarizePackage({ ...base, payments: [paid(60_000), paid(100_000)] });
    assert.equal(full.paymentState, "paid");
    assert.equal(full.balanceMinor, 0);
  });

  test("a partly paid package is NOT activated automatically", () => {
    assert.equal(statusAfterPayment("awaiting_payment", summarizePackage({ ...base, payments: [paid(150_000)] })), "awaiting_payment");
    assert.equal(statusAfterPayment("awaiting_payment", summarizePackage({ ...base, payments: [paid(160_000)] })), "active");
    assert.equal(statusAfterPayment("cancelled", summarizePackage({ ...base, payments: [paid(160_000)] })), "cancelled");
  });

  test("waivers reduce the amount due; refunds reduce the amount paid (integer paise)", () => {
    const s = summarizePackage({
      ...base,
      payments: [paid(160_000)],
      adjustments: [
        { kind: "waiver", amountMinor: 10_000, credits: 0 },
        { kind: "refund", amountMinor: 40_050, credits: 0 },
      ],
    });
    assert.equal(s.dueMinor, 150_000);
    assert.equal(s.netPaidMinor, 119_950);
    assert.equal(s.balanceMinor, 30_050);
    assert.equal(s.refundedMinor, 40_050);
    for (const v of Object.values(s)) if (typeof v === "number") assert.ok(Number.isSafeInteger(v));
  });

  test("credit adjustments change the classes available", () => {
    const s = summarizePackage({ ...base, creditsUsed: 4, payments: [paid(160_000)], adjustments: [{ kind: "credit", amountMinor: 0, credits: 1 }] });
    assert.equal(s.creditsTotal, 5);
    assert.equal(s.creditsRemaining, 1);
  });

  test("next payment: balance first, then renewal after the 4th class; never 'overdue'", () => {
    const owing = summarizePackage({ ...base, payments: [paid(60_000)] });
    assert.deepEqual(nextPayment("regular", "awaiting_payment", owing), { kind: "balance_due", amountMinor: 100_000 });
    const midway = summarizePackage({ ...base, creditsUsed: 3, payments: [paid(160_000)] });
    assert.deepEqual(nextPayment("regular", "active", midway), { kind: "renewal_after", classesLeft: 1 });
    const used = summarizePackage({ ...base, creditsUsed: 4, payments: [paid(160_000)] });
    assert.deepEqual(nextPayment("regular", "credits_used", used), { kind: "renewal_due" });
    // Voice Culture is one-time: no renewal.
    assert.deepEqual(nextPayment("program", "credits_used", used), { kind: "none" });
    for (const s of [owing, midway, used]) assert.equal(JSON.stringify(nextPayment("regular", "active", s)).includes("overdue"), false);
  });
});

// --- Payments ------------------------------------------------------------------------

describe("what counts as received revenue", () => {
  test("only paid AND verified", () => {
    assert.equal(countsAsReceived({ status: "pending", verified: false }), false);
    assert.equal(countsAsReceived({ status: "failed", verified: false }), false);
    assert.equal(countsAsReceived({ status: "paid", verified: false }), false);
    assert.equal(countsAsReceived({ status: "refunded", verified: true }), false);
    assert.equal(countsAsReceived({ status: "paid", verified: true }), true);
  });

  test("a package balance ignores pending, rejected and unverified payments", () => {
    const s = summarizePackage({
      priceMinor: 160_000,
      sessionsIncluded: 4,
      creditsUsed: 0,
      adjustments: [],
      payments: [
        { amountMinor: 160_000, status: "pending", verified: false },
        { amountMinor: 160_000, status: "failed", verified: false },
        { amountMinor: 160_000, status: "paid", verified: false },
      ],
    });
    assert.equal(s.netPaidMinor, 0);
    assert.equal(s.pendingMinor, 160_000);
    assert.equal(s.paymentState, "unpaid");
  });

  test("revenue by month and ISO week (IST); refunds counted by refund date", () => {
    const payments = [
      { amountMinor: 160_000, status: "paid", verified: true, paidAt: "2026-10-31T19:00:00.000Z" }, // 1 Nov, 00:30 IST
      { amountMinor: 150_000, status: "paid", verified: true, paidAt: "2026-10-15T06:30:00.000Z" },
      { amountMinor: 999_900, status: "pending", verified: false, paidAt: "2026-10-15T06:30:00.000Z" },
      { amountMinor: 999_900, status: "failed", verified: false, paidAt: "2026-10-15T06:30:00.000Z" },
      { amountMinor: 999_900, status: "paid", verified: false, paidAt: "2026-10-15T06:30:00.000Z" },
    ];
    const refunds = [{ amountMinor: 50_000, at: "2026-11-02T06:30:00.000Z" }];
    assert.deepEqual(
      revenueByPeriod(payments, refunds, "month").map((r) => [r.period, r.receivedMinor, r.receivedCount, r.refundedMinor, r.netMinor]),
      [
        ["2026-11", 160_000, 1, 50_000, 110_000],
        ["2026-10", 150_000, 1, 0, 150_000],
      ],
    );
    assert.equal(istPeriod("2026-10-15T06:30:00.000Z", "week"), "2026-W42");
    // 1 Jan 2027 (IST) falls in ISO week 53 of 2026.
    assert.equal(istPeriod("2026-12-31T20:00:00.000Z", "week"), "2026-W53");
  });

  test("duplicate references: case and spacing do not make a different reference", () => {
    assert.equal(normalizeReference(" utr 1234 5678 "), normalizeReference("UTR12345678"));
    assert.notEqual(normalizeReference("UTR1"), normalizeReference("UTR2"));
  });
});

// --- Class credits ------------------------------------------------------------------------

/** Simulates the server's outcome transaction against an in-memory ledger. */
function recordOutcome(ledger, cls, attendance) {
  const id = cls.packageId ? creditLedgerId(cls.packageId, cls.sessionKey) : null;
  const decision = outcomeCredit({ packageLinked: Boolean(cls.packageId), attendance, ledgerExists: id ? ledger.has(id) : false });
  if (decision.ok && decision.consume) ledger.add(id);
  return decision;
}

describe("class credits", () => {
  const cls = { id: "c1", packageId: "pkg_a", sessionKey: "c1" };

  test("attended consumes one credit", () => {
    const ledger = new Set();
    assert.equal(recordOutcome(ledger, cls, "attended").consume, true);
    assert.equal(ledger.size, 1);
  });

  test("student absence consumes one credit", () => {
    const ledger = new Set();
    assert.equal(recordOutcome(ledger, cls, "absent").consume, true);
    assert.equal(ledger.size, 1);
  });

  test("unknown attendance consumes nothing and cannot finalise a package class", () => {
    const ledger = new Set();
    const r = recordOutcome(ledger, cls, "unknown");
    assert.equal(r.ok, false);
    assert.match(r.error, /Attended or Absent/);
    assert.equal(ledger.size, 0);
  });

  test("academy cancellation consumes nothing: the credit stays free to reschedule", () => {
    assert.equal(creditsAvailableToSchedule(4, [{ sessionKey: "c1", status: "cancelled" }]), 4);
  });

  test("re-recording an outcome (or a retried request) never consumes a second credit", () => {
    const ledger = new Set();
    recordOutcome(ledger, cls, "attended");
    assert.equal(recordOutcome(ledger, cls, "absent").consume, false);
    assert.equal(recordOutcome(ledger, cls, "attended").consume, false);
    assert.equal(ledger.size, 1);
  });

  test("a pair session (two class records, one sessionKey) consumes ONE shared credit", () => {
    const ledger = new Set();
    const learnerA = { id: "a1", packageId: "pkg_pair", sessionKey: "s1" };
    const learnerB = { id: "b1", packageId: "pkg_pair", sessionKey: "s1" };
    assert.equal(recordOutcome(ledger, learnerA, "attended").consume, true);
    assert.equal(recordOutcome(ledger, learnerB, "absent").consume, false);
    assert.equal(recordOutcome(ledger, learnerB, "attended").consume, false);
    assert.equal(ledger.size, 1);
    // Two scheduled records of one session reserve one credit, not two.
    assert.equal(creditsAvailableToSchedule(4, [{ sessionKey: "s2", status: "scheduled" }, { sessionKey: "s2", status: "scheduled" }]), 3);
    // Once one record of the session is completed (charged), the other no longer reserves a credit.
    assert.equal(creditsAvailableToSchedule(3, [{ sessionKey: "s1", status: "completed" }, { sessionKey: "s1", status: "scheduled" }]), 3);
  });

  test("an exhausted or unpaid package cannot receive new classes", () => {
    assert.match(schedulingBlock("active", 0), /no class credits left/);
    assert.match(schedulingBlock("credits_used", 0), /no class credits left/);
    assert.match(schedulingBlock("awaiting_payment", 4), /awaiting payment/);
    assert.match(schedulingBlock("cancelled", 4), /cancelled/);
    assert.equal(schedulingBlock("active", 1), null);
    const four = ["a", "b", "c", "d"].map((k) => ({ sessionKey: k, status: "scheduled" }));
    assert.equal(creditsAvailableToSchedule(4, four), 0);
  });

  test("using the last credit marks the package as used", () => {
    assert.equal(statusAfterConsumption("active", 1), "active");
    assert.equal(statusAfterConsumption("active", 0), "credits_used");
    assert.equal(statusAfterConsumption("cancelled", 0), "cancelled");
  });

  test("classes without a package never touch the ledger", () => {
    const ledger = new Set();
    const legacy = { id: "old", packageId: null, sessionKey: null };
    for (const a of ["attended", "absent", "unknown"]) assert.deepEqual(recordOutcome(ledger, legacy, a), { ok: true, consume: false });
    assert.equal(ledger.size, 0);
  });
});

// --- Ownership (pure predicates; the server applies the same checks) -------------------------

describe("ownership checks", () => {
  const teacher = { uid: "t1", role: "teacher" };
  const asha = { uid: "asha", role: "student" };
  const bala = { uid: "bala", role: "student" };
  const chitra = { uid: "chitra", role: "student" };
  const pairPkg = { learnerIds: ["asha", "bala"] };
  const soloPkg = { learnerIds: ["chitra"] };

  test("students see only packages that list them", () => {
    assert.equal(canViewLearnerRecord(asha, pairPkg), true);
    assert.equal(canViewLearnerRecord(bala, pairPkg), true);
    assert.equal(canViewLearnerRecord(chitra, pairPkg), false);
    assert.equal(canViewLearnerRecord(asha, soloPkg), false);
    assert.equal(canViewLearnerRecord(teacher, soloPkg), true);
  });

  test("pair receipt: both linked learners, nobody else", () => {
    const receipt = { learnerIds: ["asha", "bala"] };
    assert.deepEqual([asha, bala, chitra].map((v) => canViewLearnerRecord(v, receipt)), [true, true, false]);
  });

  test("students cannot see another student's unrelated payments", () => {
    const chitraPayment = { studentId: "chitra", learnerIds: ["chitra"] };
    const pairPayment = { studentId: "asha", learnerIds: ["asha", "bala"] };
    assert.equal(canViewPayment(asha, chitraPayment), false);
    assert.equal(canViewPayment(bala, pairPayment), true);
    assert.equal(canViewPayment(chitra, pairPayment), false);
    assert.equal(canViewPayment(teacher, chitraPayment), true);
  });

  test("an unknown role sees nothing", () => {
    assert.equal(canViewLearnerRecord({ uid: "asha", role: "guest" }, pairPkg), false);
    assert.equal(canViewPayment({ uid: "asha", role: "guest" }, { studentId: "asha", learnerIds: ["asha"] }), false);
  });

  test("the student payment view drops notes, history, staff emails and the full reference", () => {
    const view = toStudentPayment({
      id: "p1", amountMinor: 160_000, currency: "INR", method: "upi", reference: "UPI-REF-99887766", paidAt: null,
      status: "paid", verified: true, packageId: "pkg_a",
      notes: "PRIVATE NOTE", history: [{ change: "x" }], createdByEmail: "teacher@example.com", updatedByEmail: "t@example.com",
    });
    assert.equal(view.referenceMasked, "••••7766");
    const json = JSON.stringify(view);
    for (const secret of ["PRIVATE NOTE", "teacher@example.com", "t@example.com", "UPI-REF-99887766", "history"]) {
      assert.equal(json.includes(secret), false, secret);
    }
  });

  test("references are masked to the last four characters", () => {
    assert.equal(maskReference("123"), "••••");
    assert.equal(maskReference(null), null);
    assert.equal(maskReference("UTR 0000 1234"), "••••1234");
  });

  test("receipt numbers are distinct for distinct sequence values", () => {
    const numbers = new Set(Array.from({ length: 2000 }, (_, i) => formatReceiptNumber(i + 1, 2026)));
    assert.equal(numbers.size, 2000);
    assert.equal(formatReceiptNumber(42, 2026), "SWR-2026-00042");
    assert.throws(() => formatReceiptNumber(0, 2026));
    assert.throws(() => formatReceiptNumber(1.5, 2026));
  });
});

// --- Static check of the Server Action source --------------------------------------------------
// Only proves every exported teacher action CALLS the teacher session check as
// its first step. It is not a substitute for testing with real sessions.

describe("every exported teacher action starts by verifying the teacher session", () => {
  for (const file of [
    "src/app/(account)/teacher/billing-actions.ts",
    "src/app/(account)/teacher/payment-actions.ts",
    "src/app/(account)/teacher/class-actions.ts",
  ]) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const parts = source.split(/^export async function /m).slice(1);
    test(`${file} (${parts.length} actions)`, () => {
      assert.ok(parts.length > 0);
      for (const part of parts) {
        const name = part.slice(0, part.indexOf("("));
        // The first statement inside runAction(...) must be the teacher session check.
        assert.match(
          part,
          /^[^]*?return runAction\("[A-Za-z]+", async \(\) => \{\s*const user = await requireActionUser\("teacher"\);/,
          `${name} must call requireActionUser("teacher") first`,
        );
      }
    });
  }
});

// --- CSV reports ---------------------------------------------------------------------------------

describe("CSV reports do not leak private details", () => {
  test("payment report masks the reference and has no email or notes columns", () => {
    const row = paymentReportRow({
      paidAt: "2026-10-12T06:30:00.000Z", studentName: "Asha", courseTitle: "Package: Swara Foundation", amountMinor: 160_000, currency: "INR",
      methodLabel: "UPI", reference: "UTR998877665544", payerName: "Parent", status: "paid", verified: true, rejectionReason: null, source: "manual", receiptId: "p1",
      // Private fields a caller might pass along must not appear.
      studentEmail: "asha@example.com", notes: "PRIVATE", createdByEmail: "teacher@example.com",
    });
    const csv = toCsv(PAYMENT_REPORT_HEADERS, [row]);
    assert.ok(csv.includes("••••5544"));
    assert.ok(csv.includes("1600.00"));
    for (const secret of ["UTR998877665544", "asha@example.com", "PRIVATE", "teacher@example.com"]) assert.equal(csv.includes(secret), false, secret);
    assert.equal(PAYMENT_REPORT_HEADERS.some((h) => /email|note/i.test(h)), false);
  });

  test("rejected and unverified payments are marked as not received", () => {
    const base = { paidAt: null, studentName: "A", courseTitle: "x", amountMinor: 1, currency: "INR", methodLabel: "UPI", reference: null, payerName: null, source: "manual", receiptId: null };
    const rejected = paymentReportRow({ ...base, status: "failed", verified: false, rejectionReason: "Bounced" });
    const unverified = paymentReportRow({ ...base, status: "paid", verified: false, rejectionReason: null });
    const col = PAYMENT_REPORT_HEADERS.indexOf("Counts as received");
    assert.equal(rejected[col], "no");
    assert.equal(unverified[col], "no");
  });

  test("package report: rupees from integer paise, learners by name only", () => {
    const summary = summarizePackage({ priceMinor: 279_000, sessionsIncluded: 4, creditsUsed: 1, payments: [{ amountMinor: 279_000, status: "paid", verified: true }], adjustments: [] });
    const row = packageReportRow({
      createdAt: "2026-10-12T06:30:00.000Z", title: "Swara Foundation", type: "pair", status: "active", priceMinor: 279_000,
      learners: [{ name: "Asha", category: "adult", studentId: "uid-secret-1" }, { name: "Bala", category: "student", studentId: "uid-secret-2" }],
      summary, classesCompleted: 1, sessionsCarriedForward: 0, notes: "PRIVATE",
    });
    const csv = toCsv(PACKAGE_REPORT_HEADERS, [row]);
    assert.ok(csv.includes("2790.00"));
    assert.ok(csv.includes("Asha + Bala"));
    for (const secret of ["uid-secret-1", "PRIVATE"]) assert.equal(csv.includes(secret), false, secret);
  });

  test("the formula-injection guard still applies to report cells", () => {
    const row = paymentReportRow({
      paidAt: null, studentName: '=HYPERLINK("http://evil")', courseTitle: "x", amountMinor: 1, currency: "INR", methodLabel: "UPI",
      reference: null, payerName: "+cmd", status: "pending", verified: false, rejectionReason: "@SUM(A1)", source: "manual", receiptId: null,
    });
    const csv = toCsv(PAYMENT_REPORT_HEADERS, [row]);
    assert.ok(csv.includes("'=HYPERLINK"));
    assert.ok(csv.includes("'+cmd"));
    assert.ok(csv.includes("'@SUM"));
  });
});
