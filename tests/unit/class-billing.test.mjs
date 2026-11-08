// Unit tests for class-based billing rules: src/lib/lms/class-billing.ts
// (four-week batch cycles, per-session individual charges, due dates, rates).
// Pure tests; transactional behaviour is covered by tests/emulator.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  accountIdFor,
  classAccessBlock,
  closablePeriod,
  BILLING_START_PERIOD,
  canAddMember,
  cycleWeeksLabel,
  DEFAULT_POLICY,
  DEFAULT_RATE_VERSION,
  individualCancellationCharge,
  invoiceDueState,
  initialAdvance,
  invoiceDueAt,
  isBatchBillable,
  isIndividualBillable,
  isWebsiteBilledPeriod,
  legacyDuesCleared,
  istDateOf,
  lastDayOf,
  monthAmounts,
  monthLines,
  monthlyInvoiceDate,
  monthlyInvoiceFromMs,
  MAX_BATCH_CAPACITY,
  monthlyInvoiceId,
  monthlyPaymentDeadline,
  nextPeriod,
  parseCapacity,
  parsePolicy,
  payableAmount,
  paymentPurposeLabel,
  paymentDeadline,
  periodLabel,
  periodOf,
  previousPeriod,
  rateChangeError,
  rateVersionForPeriod,
  shouldSuspend,
  summarizeInvoice,
} from "../../src/lib/lms/class-billing.ts";

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

describe("calendar-month invoices (IST)", () => {
  const at = (date, hh = "13:30") => `${date}T${hh}:00.000Z`; // 13:30 UTC = 7:00 PM IST
  const charge = (n, date, extra = {}) => ({ classId: `c${n}`, period: date.slice(0, 7), startAt: at(date), invoiceId: null, coveredBy: null, rateMinor: 40_000, ...extra });

  test("the billing period is the IST calendar month; last day for 28-, 29-, 30- and 31-day months", () => {
    assert.equal(lastDayOf("2026-11"), "2026-11-30");
    assert.equal(lastDayOf("2026-12"), "2026-12-31");
    assert.equal(lastDayOf("2027-02"), "2027-02-28");
    assert.equal(lastDayOf("2028-02"), "2028-02-29"); // leap year
    assert.equal(periodOf("2026-11-30T18:29:59.999Z"), "2026-11"); // 23:59:59.999 IST on 30 Nov
    assert.equal(periodOf("2026-11-30T18:30:00.000Z"), "2026-12"); // midnight IST
  });

  test("an invoice is generated on the last calendar day (from 23:00 IST), never earlier", () => {
    assert.equal(new Date(monthlyInvoiceFromMs("2026-11")).toISOString(), "2026-11-30T17:30:00.000Z"); // 30 Nov 23:00 IST
    assert.equal(closablePeriod(Date.parse("2026-11-30T17:29:59.999Z")), "2026-10");
    assert.equal(closablePeriod(Date.parse("2026-11-30T17:30:00.000Z")), "2026-11");
    assert.equal(closablePeriod(Date.parse("2026-12-15T06:00:00.000Z")), "2026-11");
  });

  test("payment deadline: end of the 3rd calendar day after the invoice date, IST (30 Nov → 3 Dec)", () => {
    assert.equal(monthlyInvoiceDate("2026-11", "2026-11-30T18:00:00.000Z"), "2026-11-30");
    assert.equal(monthlyPaymentDeadline("2026-11-30"), "2026-12-03T18:29:59.999Z"); // 3 Dec 23:59:59.999 IST
    assert.equal(monthlyPaymentDeadline("2026-12-31"), "2027-01-03T18:29:59.999Z"); // across the year end
    assert.equal(monthlyPaymentDeadline("2027-02-28"), "2027-03-03T18:29:59.999Z");
    assert.equal(monthlyPaymentDeadline("2028-02-29"), "2028-03-03T18:29:59.999Z");
  });

  test("an invoice generated late (job down) is dated when issued, so the full 3-day window still applies", () => {
    assert.equal(monthlyInvoiceDate("2026-11", "2026-12-02T05:00:00.000Z"), "2026-12-02");
    assert.equal(monthlyPaymentDeadline(monthlyInvoiceDate("2026-11", "2026-12-02T05:00:00.000Z")), "2026-12-05T18:29:59.999Z");
  });

  test("overdue only after the deadline instant; no restriction during the 3-day window", () => {
    const deadline = monthlyPaymentDeadline("2026-11-30");
    const inv = { dueAt: deadline, deadlineAt: deadline };
    assert.equal(invoiceDueState(inv, Date.parse("2026-11-30T18:00:00.000Z")), "not_due");
    assert.equal(invoiceDueState(inv, Date.parse(deadline)), "not_due");
    assert.equal(invoiceDueState(inv, Date.parse(deadline) + 1), "overdue");
    const issued = (balanceMinor) => ({ status: "issued", ...inv, balanceMinor });
    assert.equal(shouldSuspend([issued(40_000)], Date.parse(deadline)), false);
    assert.equal(shouldSuspend([issued(40_000)], Date.parse(deadline) + 1), true);
  });

  test("a month with 4 or 5 weekly classes is billed for exactly the classes held", () => {
    // November 2026 has 4 Saturdays; January 2027 has 5.
    const nov = ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"].map((d, i) => charge(i + 1, d));
    const jan = ["2027-01-02", "2027-01-09", "2027-01-16", "2027-01-23", "2027-01-30"].map((d, i) => charge(i + 10, d));
    assert.equal(monthAmounts(monthLines(nov, "2026-11")).amountDueMinor, 160_000);
    assert.equal(monthAmounts(monthLines(jan, "2027-01")).amountDueMinor, 200_000);
    // An academy-cancelled class is never charged, so it simply is not there: a smaller invoice, nothing invented.
    assert.equal(monthAmounts(monthLines(nov.filter((c) => c.classId !== "c3"), "2026-11")).amountDueMinor, 120_000);
  });

  test("the initial enrolment payment is deducted once, on the invoice that lists the first class", () => {
    const nov = ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"].map((d, i) => charge(i + 1, d, i === 0 ? { coveredBy: "advance" } : {}));
    const a = monthAmounts(monthLines(nov, "2026-11"));
    assert.deepEqual(a, { subtotalMinor: 160_000, initialPaymentMinor: 40_000, amountDueMinor: 120_000 });
    // Individual: ₹750 per session, the first session deducted.
    const ind = [charge(1, "2026-11-11", { rateMinor: 75_000, coveredBy: "advance" }), charge(2, "2026-11-18", { rateMinor: 75_000 })];
    assert.deepEqual(monthAmounts(ind), { subtotalMinor: 150_000, initialPaymentMinor: 75_000, amountDueMinor: 75_000 });
    // Never below zero (only the first class held this month).
    assert.equal(monthAmounts([nov[0]]).amountDueMinor, 0);
  });

  test("future months are never billed; a class recorded after its month's invoice goes on the next invoice, once", () => {
    const decClass = charge(5, "2026-12-05");
    assert.deepEqual(monthLines([decClass], "2026-11"), []);
    const lateNov = charge(6, "2026-11-28"); // recorded after the November invoice existed
    const invoicedNov = { ...charge(4, "2026-11-21"), invoiceId: "inv-nov" };
    assert.deepEqual(monthLines([invoicedNov, lateNov, decClass], "2026-12").map((c) => c.classId), ["c6", "c5"]);
  });

  test("one deterministic invoice id per account and month (retries cannot duplicate); history ids differ", () => {
    const acc = accountIdFor("uid1", "swara", "batch");
    assert.equal(monthlyInvoiceId(acc, "2026-11"), "ba_uid1_swara_batch_m2026-11");
    assert.notEqual(monthlyInvoiceId(acc, "2026-11"), monthlyInvoiceId(acc, "2026-12"));
    // First-model monthly invoices (`…_2026-11`) and cycle invoices (`…_c1`) keep their own ids.
    assert.notEqual(monthlyInvoiceId(acc, "2026-11"), `${acc}_2026-11`);
    assert.equal(cycleWeeksLabel(2), "weeks 5–8");
  });

  test("IST dates", () => {
    assert.equal(istDateOf("2026-11-07T13:30:00.000Z"), "2026-11-07");
    assert.equal(istDateOf("2026-11-06T18:30:00.000Z"), "2026-11-07"); // midnight IST
  });

  test("payment history labels", () => {
    assert.equal(paymentPurposeLabel({ purpose: "invoice", invoiceId: "ba_u_c_batch_m2026-11" }), "Invoice — November 2026");
    assert.match(paymentPurposeLabel({ purpose: "invoice", invoiceId: "ba_u_c_batch_c2" }), /cycle 2 \(weeks 5–8, earlier billing\)/);
    assert.match(paymentPurposeLabel({ purpose: "invoice", invoiceId: "ba_u_c_batch_2026-11" }), /earlier monthly invoice/);
    assert.equal(paymentPurposeLabel({ purpose: "registration", invoiceId: null }), "Initial enrolment payment");
    assert.equal(paymentPurposeLabel({ purpose: null, invoiceId: null }), null);
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
  test("student cancellation of a batch class is billable (confirmed; the recording is provided), whatever the stored setting", () => {
    assert.equal(isBatchBillable("student_cancelled", DEFAULT_POLICY), true);
    assert.equal(isBatchBillable("student_cancelled", { ...DEFAULT_POLICY, batchStudentCancelled: "not_billable" }), true);
  });
});

describe("individual billability (monthly invoice)", () => {
  test("attended and absent are billable; unknown, academy cancellation and rescheduling are not", () => {
    for (const o of ["attended", "absent"]) assert.equal(isIndividualBillable(o, false), true, o);
    for (const o of ["unknown", "academy_cancelled", "rescheduled"]) {
      assert.equal(isIndividualBillable(o, false), false, o);
      assert.equal(isIndividualBillable(o, true), false, o);
    }
  });
  test("student cancellation is billable, whatever the notice (confirmed)", () => {
    assert.equal(isIndividualBillable("student_cancelled", true), true);
    assert.equal(isIndividualBillable("student_cancelled", false), true);
  });
});

describe("individual sessions: 24-hour cancellation rule", () => {
  const start = Date.parse("2026-11-20T13:30:00.000Z"); // 7:00 PM IST
  const H = 3_600_000;
  test("student cancels even well before the start → still payable (confirmed)", () => {
    assert.equal(individualCancellationCharge({ kind: "student", startAtMs: start, cancelledAtMs: start - 72 * H }), "payable");
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
  test("an earlier per-session charge is payable only while due, at its own amount", () => {
    assert.equal(payableAmount({ kind: "session", status: "due", amountMinor: 75_000 }), 75_000);
    assert.equal(payableAmount({ kind: "session", status: "paid", amountMinor: 75_000 }), null);
    assert.equal(payableAmount({ kind: "session", status: "no_charge", amountMinor: 75_000 }), null);
  });
});

describe("history deadlines, suspension and the next-class block", () => {
  const checkpoint = "2026-12-04T18:29:59.999Z";
  const cycleInvoice = (balanceMinor, status = "issued") => ({ status, dueAt: checkpoint, deadlineAt: checkpoint, balanceMinor });
  test("existing four-week cycle invoices keep their stored checkpoint deadline", () => {
    const due = Date.parse(checkpoint);
    assert.equal(invoiceDueState({ dueAt: checkpoint, deadlineAt: checkpoint }, due), "not_due");
    assert.equal(invoiceDueState({ dueAt: checkpoint, deadlineAt: checkpoint }, due + 1), "overdue");
  });
  test("first-model monthly invoices keep their own due date + 7-day deadline", () => {
    assert.equal(invoiceDueAt("2026-11"), "2026-11-30T18:29:59.999Z");
    assert.equal(paymentDeadline("2026-11"), "2026-12-07T18:29:59.999Z");
    const m = { dueAt: invoiceDueAt("2026-11"), deadlineAt: paymentDeadline("2026-11") };
    assert.equal(invoiceDueState(m, Date.parse(m.dueAt) + 1), "grace");
    assert.equal(invoiceDueState(m, Date.parse(m.deadlineAt) + 1), "overdue");
  });
  test("suspend only when an issued invoice is unpaid after its deadline; partly paid still counts; restored once paid", () => {
    const after = Date.parse(checkpoint) + 1;
    assert.equal(shouldSuspend([cycleInvoice(1)], Date.parse(checkpoint)), false);
    assert.equal(shouldSuspend([cycleInvoice(1)], after), true);
    assert.equal(shouldSuspend([cycleInvoice(0)], after), false);
    assert.equal(shouldSuspend([cycleInvoice(1, "void")], after), false);
    // Two overdue invoices: paying one is not enough.
    assert.equal(shouldSuspend([cycleInvoice(0), cycleInvoice(40_000)], after), true);
  });
  test("next-class block for batch AND individual accounts: suspension or an unverified initial payment", () => {
    const acc = (o = {}) => ({ mode: "batch", status: "active", advance: { status: "verified" }, suspension: { active: false }, ...o });
    assert.equal(classAccessBlock(acc()), null);
    assert.equal(classAccessBlock(acc({ advance: { status: "applied" } })), null);
    assert.equal(classAccessBlock(acc({ suspension: { active: true } })), "suspended");
    assert.equal(classAccessBlock(acc({ advance: { status: "awaiting" } })), "first_class_unpaid");
    assert.equal(classAccessBlock(acc({ mode: "individual", suspension: { active: true } })), "suspended");
    assert.equal(classAccessBlock(acc({ mode: "individual", advance: { status: "not_required" } })), null);
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
  test("credit/debit notes (and old monthly advance adjustments) adjust the total without editing the invoice", () => {
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
    assert.deepEqual(parsePolicy({ batchStudentCancelled: "billable" }).value, DEFAULT_POLICY);
    assert.ok(parsePolicy({ batchStudentCancelled: "maybe" }).errors.batchStudentCancelled);
  });
});
