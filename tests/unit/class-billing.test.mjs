// Unit tests for class-based billing rules: src/lib/lms/class-billing.ts
// (monthly batch invoices, per-session individual charges, deadlines, rates).
// Pure tests; transactional behaviour is covered by tests/emulator.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  accountIdFor,
  advanceRemaining,
  BILLING_START_PERIOD,
  buildMonthlyInvoice,
  canAddMember,
  completedPeriods,
  DEFAULT_POLICY,
  DEFAULT_RATE_VERSION,
  dueState,
  individualCancellationCharge,
  initialAdvance,
  invoiceDueAt,
  isBatchBillable,
  isWebsiteBilledPeriod,
  legacyDuesCleared,
  MAX_BATCH_CAPACITY,
  monthlyInvoiceId,
  nextPeriod,
  parseCapacity,
  parsePolicy,
  payableAmount,
  paymentDeadline,
  periodLabel,
  periodOf,
  previousPeriod,
  rateChangeError,
  rateVersionForPeriod,
  shouldSuspend,
  summarizeInvoice,
} from "../../src/lib/lms/class-billing.ts";

const line = (n, rateMinor = 40_000, period = "2026-11") => ({ classId: `c${n}`, date: "2026-11-07", title: "Class", outcome: "attended", rateMinor, rateVersionId: "v1", period });
const lines = (n, rate) => Array.from({ length: n }, (_, i) => line(i + 1, rate));
const verified = (amountMinor = 40_000, appliedMinor = 0) => ({ status: "verified", amountMinor, appliedMinor, paymentId: "p" });

describe("confirmed rates and start of website billing", () => {
  test("₹400 batch class, ₹750 individual session, ₹400 advance; from November 2026", () => {
    assert.deepEqual(
      [DEFAULT_RATE_VERSION.batchMinor, DEFAULT_RATE_VERSION.individualMinor, DEFAULT_RATE_VERSION.batchAdvanceMinor, DEFAULT_RATE_VERSION.effectiveFrom],
      [40_000, 75_000, 40_000, "2026-11"],
    );
    assert.equal(BILLING_START_PERIOD, "2026-11");
  });
  test("classes up to October 2026 are never billed by the website", () => {
    assert.equal(isWebsiteBilledPeriod("2026-10"), false);
    assert.equal(isWebsiteBilledPeriod("2026-11"), true);
    assert.equal(isWebsiteBilledPeriod("2027-01"), true);
  });
});

describe("monthly batch invoices", () => {
  test("8 classes × ₹400 = ₹3,200 − verified ₹400 advance = ₹2,800", () => {
    const d = buildMonthlyInvoice({ lines: lines(8), advance: verified() });
    assert.deepEqual([d.subtotalMinor, d.advanceAppliedMinor, d.amountDueMinor], [320_000, 40_000, 280_000]);
    assert.equal(d.advanceAfter.status, "applied");
    assert.equal(advanceRemaining(d.advanceAfter), 0);
  });

  test("an unpaid or unverified advance is never deducted", () => {
    for (const status of ["awaiting", "not_required", "refunded"]) {
      const d = buildMonthlyInvoice({ lines: lines(8), advance: { status, amountMinor: 40_000, appliedMinor: 0, paymentId: null } });
      assert.equal(d.advanceAppliedMinor, 0, status);
      assert.equal(d.amountDueMinor, 320_000, status);
    }
  });

  test("the advance is applied only once across months", () => {
    const nov = buildMonthlyInvoice({ lines: lines(4), advance: verified() });
    const dec = buildMonthlyInvoice({ lines: lines(4), advance: nov.advanceAfter });
    assert.deepEqual([nov.advanceAppliedMinor, dec.advanceAppliedMinor], [40_000, 0]);
    assert.deepEqual([nov.amountDueMinor, dec.amountDueMinor], [120_000, 160_000]);
  });

  test("an unused advance balance is carried forward (never lost)", () => {
    // A ₹400 advance against a ₹300 month (e.g. after a rate change or credit): ₹100 stays for later.
    const first = buildMonthlyInvoice({ lines: [line(1, 30_000)], advance: verified() });
    assert.deepEqual([first.advanceAppliedMinor, first.amountDueMinor, advanceRemaining(first.advanceAfter)], [30_000, 0, 10_000]);
    const second = buildMonthlyInvoice({ lines: [line(2)], advance: first.advanceAfter });
    assert.deepEqual([second.advanceAppliedMinor, second.amountDueMinor, advanceRemaining(second.advanceAfter)], [10_000, 30_000, 0]);
  });

  test("each class keeps its own historical rate", () => {
    const d = buildMonthlyInvoice({ lines: [line(1, 40_000), line(2, 45_000)], advance: { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null } });
    assert.equal(d.subtotalMinor, 85_000);
  });

  test("one deterministic invoice id per account and month (retries cannot duplicate)", () => {
    const a = accountIdFor("uid1", "swara", "batch");
    assert.equal(monthlyInvoiceId(a, "2026-11"), "ba_uid1_swara_batch_2026-11");
    assert.equal(monthlyInvoiceId(a, "2026-11"), monthlyInvoiceId(a, "2026-11"));
    assert.notEqual(monthlyInvoiceId(a, "2026-11"), monthlyInvoiceId(a, "2026-12"));
  });

  test("integer paise throughout", () => {
    const d = buildMonthlyInvoice({ lines: lines(7), advance: verified() });
    for (const v of [d.subtotalMinor, d.advanceAppliedMinor, d.amountDueMinor]) assert.ok(Number.isSafeInteger(v));
  });
});

describe("batch billability (confirmed policies)", () => {
  test("attended and absent are billable", () => {
    assert.equal(isBatchBillable("attended", DEFAULT_POLICY), true);
    assert.equal(isBatchBillable("absent", DEFAULT_POLICY), true);
  });
  test("academy cancellation, rescheduled and unknown are never billable", () => {
    const permissive = { ...DEFAULT_POLICY, batchStudentCancelled: "billable" };
    for (const o of ["academy_cancelled", "rescheduled", "unknown"]) {
      assert.equal(isBatchBillable(o, DEFAULT_POLICY), false, o);
      assert.equal(isBatchBillable(o, permissive), false, o);
    }
  });
  test("student cancellation of a batch class: pending decision, not billed by default", () => {
    assert.equal(isBatchBillable("student_cancelled", DEFAULT_POLICY), false);
    assert.equal(isBatchBillable("student_cancelled", { ...DEFAULT_POLICY, batchStudentCancelled: "billable" }), true);
  });
});

describe("individual sessions: 24-hour cancellation rule", () => {
  const start = Date.parse("2026-11-20T13:30:00.000Z"); // 7:00 PM IST
  const H = 3_600_000;
  test("student cancels exactly 24 hours before → no charge", () => {
    assert.equal(individualCancellationCharge({ kind: "student", startAtMs: start, cancelledAtMs: start - 24 * H }), "no_charge");
  });
  test("student cancels 1 ms less than 24 hours before → payable", () => {
    assert.equal(individualCancellationCharge({ kind: "student", startAtMs: start, cancelledAtMs: start - 24 * H + 1 }), "payable");
  });
  test("student cancels after the start → payable", () => {
    assert.equal(individualCancellationCharge({ kind: "student", startAtMs: start, cancelledAtMs: start + H }), "payable");
  });
  test("academy cancellation or rescheduling → no charge, whenever it happens", () => {
    for (const kind of ["academy", "rescheduled"]) assert.equal(individualCancellationCharge({ kind, startAtMs: start, cancelledAtMs: start - H }), "no_charge", kind);
  });
  test("a session is payable only while due, at its own amount", () => {
    assert.equal(payableAmount({ kind: "session", status: "due", amountMinor: 75_000 }), 75_000);
    assert.equal(payableAmount({ kind: "session", status: "paid", amountMinor: 75_000 }), null);
    assert.equal(payableAmount({ kind: "session", status: "no_charge", amountMinor: 75_000 }), null);
  });
});

describe("due date, 7-day grace period and suspension (IST)", () => {
  test("November 2026: due 30 Nov 23:59:59.999 IST; deadline 7 Dec 23:59:59.999 IST", () => {
    assert.equal(invoiceDueAt("2026-11"), "2026-11-30T18:29:59.999Z");
    assert.equal(paymentDeadline("2026-11"), "2026-12-07T18:29:59.999Z");
  });
  test("year end: December 2026 deadline is 7 Jan 2027", () => {
    assert.equal(invoiceDueAt("2026-12"), "2026-12-31T18:29:59.999Z");
    assert.equal(paymentDeadline("2026-12"), "2027-01-07T18:29:59.999Z");
  });
  test("exact boundaries", () => {
    const due = Date.parse(invoiceDueAt("2026-11"));
    const deadline = Date.parse(paymentDeadline("2026-11"));
    assert.equal(dueState("2026-11", due), "not_due");
    assert.equal(dueState("2026-11", due + 1), "grace");
    assert.equal(dueState("2026-11", deadline), "grace");
    assert.equal(dueState("2026-11", deadline + 1), "overdue");
  });
  test("suspend only when an issued invoice is unpaid after the deadline", () => {
    const deadline = Date.parse(paymentDeadline("2026-11"));
    const inv = (balanceMinor, status = "issued") => [{ status, period: "2026-11", balanceMinor }];
    assert.equal(shouldSuspend(inv(1), deadline), false);
    assert.equal(shouldSuspend(inv(1), deadline + 1), true);
    assert.equal(shouldSuspend(inv(0), deadline + 1), false);
    assert.equal(shouldSuspend(inv(1, "void"), deadline + 1), false);
  });
  test("restored once paid: the same rule is re-evaluated after verified payment", () => {
    const later = Date.parse("2026-12-20T00:00:00.000Z");
    assert.equal(shouldSuspend([{ status: "issued", period: "2026-11", balanceMinor: 120_000 }], later), true);
    assert.equal(shouldSuspend([{ status: "issued", period: "2026-11", balanceMinor: 0 }], later), false);
  });
});

describe("periods (IST)", () => {
  test("IST month boundaries", () => {
    assert.equal(periodOf("2026-11-30T18:29:59.999Z"), "2026-11");
    assert.equal(periodOf("2026-11-30T18:30:00.000Z"), "2026-12");
  });
  test("navigation and labels", () => {
    assert.deepEqual([nextPeriod("2026-12"), previousPeriod("2027-01")], ["2027-01", "2026-12"]);
    assert.equal(periodLabel("2026-11"), "November 2026");
  });
  test("only completed months from November 2026 are invoiced", () => {
    assert.deepEqual(completedPeriods("2026-11-15T00:00:00.000Z"), []);
    assert.deepEqual(completedPeriods("2026-12-01T00:00:00.000Z"), ["2026-11"]);
    assert.deepEqual(completedPeriods("2027-02-10T00:00:00.000Z"), ["2026-11", "2026-12", "2027-01"]);
  });
});

describe("rate changes apply from the next calendar month", () => {
  const v2 = { ...DEFAULT_RATE_VERSION, id: "v2", effectiveFrom: "2027-01", batchMinor: 45_000 };
  test("version by billing month", () => {
    assert.equal(rateVersionForPeriod([DEFAULT_RATE_VERSION, v2], "2026-12").batchMinor, 40_000);
    assert.equal(rateVersionForPeriod([DEFAULT_RATE_VERSION, v2], "2027-01").batchMinor, 45_000);
    assert.equal(rateVersionForPeriod([], "2027-01").batchMinor, 40_000);
  });
  test("a change cannot start in the current or a past month", () => {
    const now = "2026-12-15T10:00:00.000Z";
    assert.match(rateChangeError("2026-12", now, [DEFAULT_RATE_VERSION]), /next month/);
    assert.match(rateChangeError("2026-11", now, [DEFAULT_RATE_VERSION]), /next month/);
    assert.equal(rateChangeError("2027-01", now, [DEFAULT_RATE_VERSION]), null);
    assert.match(rateChangeError("2027-01", now, [DEFAULT_RATE_VERSION, v2]), /already/);
    assert.match(rateChangeError("2027-13", now, []), /month/);
  });
  test("near month end in IST: 31 Dec 23:00 IST is still December", () => {
    assert.match(rateChangeError("2026-12", "2026-12-31T17:30:00.000Z", []), /next month/);
    assert.equal(rateChangeError("2027-01", "2026-12-31T17:30:00.000Z", []), null);
  });
});

describe("advance", () => {
  test("batch accounts start with a ₹400 advance awaiting payment; individual accounts need none", () => {
    assert.deepEqual(initialAdvance("batch", DEFAULT_RATE_VERSION), { status: "awaiting", amountMinor: 40_000, appliedMinor: 0, paymentId: null });
    assert.equal(initialAdvance("individual", DEFAULT_RATE_VERSION).status, "not_required");
  });
  test("payable only while awaiting, exactly the configured amount", () => {
    assert.equal(payableAmount({ kind: "advance", advance: initialAdvance("batch", DEFAULT_RATE_VERSION) }), 40_000);
    assert.equal(payableAmount({ kind: "advance", advance: verified() }), null);
  });
});

describe("invoice balances", () => {
  const paid = (amountMinor) => ({ amountMinor, status: "paid", verified: true });
  test("partial and full payment; only verified payments count", () => {
    assert.equal(summarizeInvoice({ amountDueMinor: 280_000, payments: [paid(100_000)], adjustments: [] }).state, "partial");
    const s = summarizeInvoice({ amountDueMinor: 280_000, payments: [paid(280_000), { amountMinor: 1, status: "paid", verified: false }, { amountMinor: 1, status: "pending", verified: false }], adjustments: [] });
    assert.deepEqual([s.state, s.balanceMinor, s.pendingMinor], ["paid", 0, 1]);
  });
  test("late-applied advance and credit/debit notes adjust the total without editing the invoice", () => {
    const s = summarizeInvoice({ amountDueMinor: 320_000, payments: [], adjustments: [{ kind: "advance_applied", amountMinor: 40_000 }, { kind: "debit_note", amountMinor: 10_000 }] });
    assert.equal(s.totalDueMinor, 290_000);
  });
  test("invoice payable amount is the outstanding balance of an issued invoice", () => {
    const summary = summarizeInvoice({ amountDueMinor: 280_000, payments: [paid(80_000)], adjustments: [] });
    assert.equal(payableAmount({ kind: "invoice", status: "issued", summary }), 200_000);
    assert.equal(payableAmount({ kind: "invoice", status: "void", summary }), null);
  });
});

describe("old dues (before November 2026)", () => {
  test("only an explicit, administrator-verified record counts", () => {
    assert.equal(legacyDuesCleared(null), false);
    assert.equal(legacyDuesCleared({ status: "cleared", verifiedBy: null, verifiedAt: null }), false);
    assert.equal(legacyDuesCleared({ status: "pending", verifiedBy: "t", verifiedAt: "2026-11-01T00:00:00.000Z" }), false);
    assert.equal(legacyDuesCleared({ status: "cleared", verifiedBy: "t", verifiedAt: "2026-11-01T00:00:00.000Z" }), true);
    assert.equal(legacyDuesCleared({ status: "no_previous_dues", verifiedBy: "t", verifiedAt: "2026-11-01T00:00:00.000Z" }), true);
  });
});

describe("batches and policy", () => {
  test("capacity ≤ 5, enforced", () => {
    assert.equal(MAX_BATCH_CAPACITY, 5);
    assert.equal(parseCapacity("6"), null);
    assert.match(canAddMember({ capacity: 5, memberCount: 5, status: "active" }), /full/);
    assert.equal(canAddMember({ capacity: 5, memberCount: 4, status: "active" }), null);
  });
  test("policy parsing", () => {
    assert.deepEqual(parsePolicy({ batchStudentCancelled: "not_billable" }).value, DEFAULT_POLICY);
    assert.ok(parsePolicy({ batchStudentCancelled: "maybe" }).errors.batchStudentCancelled);
  });
});
