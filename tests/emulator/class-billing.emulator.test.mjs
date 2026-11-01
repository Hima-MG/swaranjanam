// Firestore EMULATOR integration tests for batches, monthly batch billing,
// individual-session charges, suspension, old-dues clearance and the gateway.
//
// Run with:  npm run test:emulator
// The "demo-" project id can never reach a real Firebase project. These tests
// run the real server modules against the local emulator and check the
// deployed firestore.rules with emulator auth tokens. Never touches production.
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

const PROJECT = "demo-swaranjanam";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST) throw new Error("FIRESTORE_EMULATOR_HOST is not set: run these tests with `npm run test:emulator`.");

process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "emulator@demo-swaranjanam.iam.gserviceaccount.com";
process.env.FIREBASE_ADMIN_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });

const { getAdminDb } = await import("@/lib/firebase/admin");
const { addMemberTx, removeMemberTx, transferMemberTx } = await import("@/lib/lms/server/batches");
const billing = await import("@/lib/lms/server/class-billing");
const { isBillingSuspended } = await import("@/lib/lms/server/access");
const { mapLiveClass } = await import("@/lib/lms/server/classes");
const { processVerifiedGatewayPayment } = await import("@/lib/lms/server/gateway");
const { paymentDeadline } = await import("@/lib/lms/class-billing");
const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

const db = getAdminDb();
const teacher = { uid: "teacher-1", email: "teacher@example.test", name: "Teacher", role: "teacher" };
const run = randomUUID().slice(0, 8);
const id = (s) => `${s}-${run}`;
const course = id("course");
const AFTER_NOV = "2026-12-01T00:00:00.000Z"; // 05:30 IST on 1 Dec: November has ended
const NOV_DEADLINE = Date.parse(paymentDeadline("2026-11"));

const clearAll = () => fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });

async function makeBatch(name, capacity = 5) {
  const ref = db.collection("batches").doc(id(name));
  await ref.set({ name, courseId: course, courseTitle: "Swara Foundation", teacherId: teacher.uid, teacherName: "Teacher", schedule: "Sat 7 PM", meetUrl: "https://meet.google.com/abc-defg-hij", capacity, memberCount: 0, status: "active" });
  return ref.id;
}
async function enroll(studentId, { cleared = true } = {}) {
  await db.collection("enrollments").doc(`${course}_${studentId}`).set({ id: `${course}_${studentId}`, studentId, courseId: course, status: "active", agreedFee: null, currency: "INR" });
  if (cleared) await db.collection("legacyDues").doc(studentId).set({ studentId, status: "no_previous_dues", note: "test", verifiedBy: teacher.uid, verifiedByEmail: teacher.email, verifiedAt: FieldValue.serverTimestamp() });
}
async function newBatchLearner(uid) {
  const batchId = await makeBatch(`b-${uid}`);
  await enroll(uid);
  return (await addMemberTx(teacher, batchId, { uid, name: uid })).accountId;
}
async function makeClass(studentId, accountId, n, startIso) {
  const start = startIso ? Date.parse(startIso) : Date.parse("2026-11-03T13:30:00.000Z") + n * 2 * 86_400_000;
  const ref = db.collection("liveClasses").doc(id(`class-${studentId}-${n}`));
  await ref.set({
    studentId, title: `Class ${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), timeZone: "Asia/Kolkata",
    date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij",
    status: "scheduled", attendance: null, packageId: null, batchId: id("b"), sessionKey: id(`s-${n}`), billingAccountId: accountId,
  });
  return mapLiveClass(await ref.get());
}
/** What recordClassOutcome does inside its transaction. */
const charge = (cls, outcome) =>
  db.runTransaction(async (tx) => {
    const plan = await billing.prepareClassCharge(tx, cls, outcome, "2026-11-30T00:00:00.000Z");
    billing.applyClassCharge(tx, plan, teacher);
    return plan.kind;
  });
const account = async (accountId) => billing.mapAccount(await db.collection("billingAccounts").doc(accountId).get());
const invoice = async (accountId, period) => billing.mapInvoice(await db.collection("invoices").doc(`${accountId}_${period}`).get());
const verifyAdvance = (accountId) =>
  db.runTransaction(async (tx) => {
    const state = await billing.readPaymentTarget(tx, { kind: "advance", accountId });
    billing.applyVerifiedPayment(tx, state, `manual-${accountId}`, teacher);
  });

before(clearAll);
after(clearAll);

describe("batch membership", () => {
  test("enrolled + old dues verified: added, billing account with a ₹400 advance opened", async () => {
    const batchId = await makeBatch("m1");
    await enroll("s1");
    const result = await addMemberTx(teacher, batchId, { uid: "s1", name: "Student One" });
    const a = await account(result.accountId);
    assert.deepEqual([a.mode, a.advance.status, a.advance.amountMinor, a.suspension.active], ["batch", "awaiting", 40_000, false]);
  });

  test("old dues NOT verified: refused (never assumed cleared)", async () => {
    const batchId = await makeBatch("m-ld");
    await enroll("s-ld", { cleared: false });
    await assert.rejects(addMemberTx(teacher, batchId, { uid: "s-ld", name: "X" }), /November 2026/);
  });

  test("a student not enrolled in the course is refused", async () => {
    const batchId = await makeBatch("m2");
    await db.collection("legacyDues").doc("not-enrolled").set({ status: "cleared", verifiedBy: "t", verifiedAt: FieldValue.serverTimestamp() });
    await assert.rejects(addMemberTx(teacher, batchId, { uid: "not-enrolled", name: "X" }), /enrolled/);
  });

  test("no duplicate active membership in the same course", async () => {
    const a = await makeBatch("m3");
    const b = await makeBatch("m4");
    await enroll("s3");
    await addMemberTx(teacher, a, { uid: "s3", name: "S3" });
    await assert.rejects(addMemberTx(teacher, a, { uid: "s3", name: "S3" }), /already in this batch/);
    await assert.rejects(addMemberTx(teacher, b, { uid: "s3", name: "S3" }), /another batch/);
  });

  test("capacity is enforced under CONCURRENT additions", async () => {
    const batchId = await makeBatch("cap", 2);
    const students = ["c1", "c2", "c3", "c4", "c5"];
    await Promise.all(students.map((s) => enroll(s)));
    const results = await Promise.allSettled(students.map((uid) => addMemberTx(teacher, batchId, { uid, name: uid })));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    assert.equal((await db.collection("batches").doc(batchId).get()).get("memberCount"), 2);
  });

  test("a transfer keeps the advance and every charge; removal cancels only future classes (not charged)", async () => {
    const from = await makeBatch("t-from");
    const to = await makeBatch("t-to");
    await enroll("s5");
    const { accountId } = await addMemberTx(teacher, from, { uid: "s5", name: "S5" });
    await charge(await makeClass("s5", accountId, 1), "attended");
    await verifyAdvance(accountId);
    const before = await account(accountId);
    await transferMemberTx(teacher, from, to, "s5");
    const afterT = await account(accountId);
    assert.deepEqual([afterT.advance, afterT.billableCount, afterT.batchId], [before.advance, 1, to]);

    const future = db.collection("liveClasses").doc(id("future-s5"));
    await future.set({ studentId: "s5", batchId: to, status: "scheduled", billingAccountId: accountId, startAt: Timestamp.fromMillis(Date.now() + 86_400_000), endAt: Timestamp.fromMillis(Date.now() + 90_000_000), title: "Next", date: "2099-01-01", startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij" });
    await removeMemberTx(teacher, to, "s5", "Left");
    assert.equal((await future.get()).get("status"), "cancelled");
    assert.equal((await db.collection("billableClasses").doc(future.id).get()).exists, false);
  });
});

describe("monthly batch billing", () => {
  test("8 classes in November with a verified advance → one invoice: ₹3,200 − ₹400 = ₹2,800, due 30 Nov, deadline 7 Dec", async () => {
    const accountId = await newBatchLearner("b1");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 8; n++) assert.equal(await charge(await makeClass("b1", accountId, n), n % 3 ? "attended" : "absent"), "charge");
    assert.equal(await billing.generateMonthlyInvoice(accountId, "2026-11", teacher, AFTER_NOV), "created");
    const inv = await invoice(accountId, "2026-11");
    assert.deepEqual([inv.lines.length, inv.subtotalMinor, inv.advanceAppliedMinor, inv.amountDueMinor], [8, 320_000, 40_000, 280_000]);
    assert.deepEqual([inv.dueAt, inv.deadlineAt], ["2026-11-30T18:29:59.999Z", "2026-12-07T18:29:59.999Z"]);
    const a = await account(accountId);
    assert.deepEqual([a.advance.status, a.advance.appliedMinor], ["applied", 40_000]);
    const ledger = await db.collection("advanceLedger").where("accountId", "==", accountId).get();
    assert.deepEqual(ledger.docs.map((d) => d.get("kind")).sort(), ["applied", "received"]);
  });

  test("retried and CONCURRENT generation never duplicates; a month cannot be invoiced before it ends", async () => {
    const accountId = await newBatchLearner("b2");
    for (let n = 1; n <= 3; n++) await charge(await makeClass("b2", accountId, n), "attended");
    const results = await Promise.all([1, 2, 3, 4].map(() => billing.generateMonthlyInvoice(accountId, "2026-11", teacher, AFTER_NOV).catch((e) => e.message)));
    assert.equal(results.filter((r) => r === "created").length, 1);
    assert.equal((await db.collection("invoices").where("accountId", "==", accountId).get()).size, 1);
    assert.equal(await billing.generateMonthlyInvoice(accountId, "2026-11", teacher, AFTER_NOV), "exists");
    await assert.rejects(billing.generateMonthlyInvoice(accountId, "2026-11", teacher, "2026-11-20T00:00:00.000Z"), /after it has ended/);
  });

  test("an unverified advance is not deducted; once verified it is applied to the NEXT invoice, once", async () => {
    const accountId = await newBatchLearner("b3");
    for (let n = 1; n <= 4; n++) await charge(await makeClass("b3", accountId, n), "attended");
    await billing.generateMonthlyInvoice(accountId, "2026-11", teacher, AFTER_NOV);
    assert.deepEqual([(await invoice(accountId, "2026-11")).amountDueMinor, (await invoice(accountId, "2026-11")).advanceAppliedMinor], [160_000, 0]);
    await verifyAdvance(accountId);
    for (let n = 1; n <= 2; n++) await charge(await makeClass("b3", accountId, 100 + n, `2026-12-0${n + 4}T13:30:00.000Z`), "attended");
    await billing.generateMonthlyInvoice(accountId, "2026-12", teacher, "2027-01-01T00:00:00.000Z");
    const dec = await invoice(accountId, "2026-12");
    assert.deepEqual([dec.subtotalMinor, dec.advanceAppliedMinor, dec.amountDueMinor], [80_000, 40_000, 40_000]);
    await billing.generateMonthlyInvoice(accountId, "2027-01", teacher, "2027-02-01T00:00:00.000Z");
    assert.equal((await account(accountId)).advance.appliedMinor, 40_000);
  });

  test("a November class recorded late (after the November invoice) is billed on the next invoice, once", async () => {
    const accountId = await newBatchLearner("b4");
    await charge(await makeClass("b4", accountId, 1), "attended");
    await billing.generateMonthlyInvoice(accountId, "2026-11", teacher, AFTER_NOV);
    await charge(await makeClass("b4", accountId, 2), "absent"); // November class, recorded in December
    await billing.generateMonthlyInvoice(accountId, "2026-12", teacher, "2027-01-01T00:00:00.000Z");
    const dec = await invoice(accountId, "2026-12");
    assert.deepEqual(dec.lines.map((l) => l.period), ["2026-11"]);
    assert.equal(dec.subtotalMinor, 40_000);
  });

  test("October 2026 classes are never charged (old payment method)", async () => {
    const accountId = await newBatchLearner("b5");
    assert.equal(await charge(await makeClass("b5", accountId, 1, "2026-10-24T13:30:00.000Z"), "attended"), "none");
    assert.equal((await account(accountId)).billableCount, 0);
  });

  test("re-recording never charges twice; un-billing a charged class is refused", async () => {
    const accountId = await newBatchLearner("b6");
    const cls = await makeClass("b6", accountId, 1);
    assert.equal(await charge(cls, "attended"), "charge");
    assert.equal(await charge(cls, "absent"), "already");
    await assert.rejects(charge(cls, "unknown"), /already charged/);
    assert.equal((await account(accountId)).billableCount, 1);
  });

  test("CONCURRENT outcomes for the same class → exactly one charge", async () => {
    const accountId = await newBatchLearner("b7");
    const cls = await makeClass("b7", accountId, 1);
    await Promise.all([1, 2, 3, 4].map(() => charge(cls, "attended").catch(() => "conflict")));
    assert.equal((await db.collection("billableClasses").where("accountId", "==", accountId).get()).size, 1);
    assert.equal((await account(accountId)).billableCount, 1);
  });

  test("academy cancellation, rescheduled and unknown create no charge", async () => {
    const accountId = await newBatchLearner("b8");
    for (const [n, o] of [[1, "academy_cancelled"], [2, "rescheduled"], [3, "unknown"], [4, "student_cancelled"]]) assert.equal(await charge(await makeClass("b8", accountId, n), o), "none");
    assert.equal((await account(accountId)).billableCount, 0);
  });

  test("a legacy package class can never be billed per class", async () => {
    const accountId = await newBatchLearner("b9");
    await assert.rejects(charge({ ...(await makeClass("b9", accountId, 1)), packageId: "pkg_legacy" }, "attended"), /prepaid package/);
  });
});

describe("overdue → reversible suspension → restored after verified payment", () => {
  test("suspended only after the deadline; access check blocks; verified payment restores", async () => {
    const accountId = await newBatchLearner("o1");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 4; n++) await charge(await makeClass("o1", accountId, n), "attended");
    await billing.generateMonthlyInvoice(accountId, "2026-11", teacher, AFTER_NOV);
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE), "unchanged"); // last instant of grace
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "suspended");
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "unchanged"); // idempotent
    assert.equal(await isBillingSuspended("o1", course), true);
    const a = await account(accountId);
    assert.equal(a.status, "active"); // nothing deleted or closed

    const invoiceId = `${accountId}_2026-11`;
    await db.collection("gatewayOrders").doc("order_O1").set({ target: { kind: "invoice", invoiceId }, studentId: "o1", amountMinor: 120_000, currency: "INR", status: "created" });
    assert.equal((await processVerifiedGatewayPayment({ orderId: "order_O1", paymentId: "pay_O1", amountMinor: 120_000, currency: "INR", status: "captured", via: "webhook" })).outcome, "recorded");
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "unchanged"); // already restored by the payment path
    assert.equal(await isBillingSuspended("o1", course), false);
  });

  test("scheduled job: invoices + suspensions, idempotent across runs", async () => {
    const accountId = await newBatchLearner("o2");
    await charge(await makeClass("o2", accountId, 1), "attended");
    const now = new Date(NOV_DEADLINE + 60_000).toISOString();
    const first = await billing.runScheduledBilling(teacher, now);
    assert.ok(first.invoicesCreated >= 1);
    assert.equal((await account(accountId)).suspension.active, true);
    const second = await billing.runScheduledBilling(teacher, now);
    assert.equal(second.invoicesCreated, 0);
    assert.equal(second.errors, 0);
    assert.equal((await db.collection("invoices").where("accountId", "==", accountId).get()).size, 1);
  });
});

describe("individual sessions (₹750, paid per session)", () => {
  async function individual(uid) {
    await enroll(uid);
    const accountId = `ba_${uid}_${course}_individual`;
    await db.collection("billingAccounts").doc(accountId).set({ studentId: uid, courseId: course, mode: "individual", status: "active", studentName: uid, courseTitle: "Coaching", advance: { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null }, suspension: { active: false } });
    return billing.mapAccount(await db.collection("billingAccounts").doc(accountId).get());
  }
  async function session(acc, n, startMs) {
    const ref = db.collection("liveClasses").doc(id(`ind-${acc.studentId}-${n}`));
    await db.runTransaction(async (tx) => {
      tx.set(ref, { studentId: acc.studentId, title: `Session ${n}`, startAt: Timestamp.fromMillis(startMs), endAt: Timestamp.fromMillis(startMs + 3_600_000), date: "2026-11-20", startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", status: "scheduled", packageId: null, batchId: null, billingAccountId: acc.id });
      billing.writeSessionCharge(tx, { classId: ref.id, account: acc, title: `Session ${n}`, date: "2026-11-20", startTime: "19:00", startAt: new Date(startMs), version: { id: "v1", effectiveFrom: "2026-11", batchMinor: 40_000, individualMinor: 75_000, batchAdvanceMinor: 40_000 }, actor: teacher });
    });
    return mapLiveClass(await ref.get());
  }
  const cancel = (cls, kind, nowMs) =>
    db.runTransaction(async (tx) => {
      const plan = await billing.prepareSessionCancel(tx, cls, kind, nowMs);
      billing.applySessionCancel(tx, plan, teacher);
      return plan.kind === "update" ? plan.decision : "none";
    });
  const chargeOf = async (cls) => billing.mapSessionCharge(await db.collection("sessionCharges").doc(`sc_${cls.id}`).get());
  const start = Date.parse("2026-11-20T13:30:00.000Z");
  const H = 3_600_000;

  test("each session gets exactly one ₹750 charge", async () => {
    const acc = await individual("i1");
    const cls = await session(acc, 1, start);
    assert.deepEqual([(await chargeOf(cls)).amountMinor, (await chargeOf(cls)).status], [75_000, "due"]);
    await assert.rejects(db.runTransaction(async (tx) => billing.writeSessionCharge(tx, { classId: cls.id, account: acc, title: "x", date: "x", startTime: "x", startAt: new Date(start), version: { id: "v1", effectiveFrom: "2026-11", batchMinor: 1, individualMinor: 75_000, batchAdvanceMinor: 1 }, actor: teacher })));
  });

  test("student cancels ≥ 24 h before → no charge; < 24 h → payable; academy → no charge (server time)", async () => {
    const acc = await individual("i2");
    const a = await session(acc, 1, start);
    const b = await session(acc, 2, start);
    const c = await session(acc, 3, start);
    assert.equal(await cancel(a, "student", start - 24 * H), "no_charge");
    assert.equal(await cancel(b, "student", start - 24 * H + 1), "payable");
    assert.equal(await cancel(c, "academy", start - H), "no_charge");
    assert.deepEqual([(await chargeOf(a)).status, (await chargeOf(b)).status, (await chargeOf(c)).status], ["no_charge", "due", "no_charge"]);
  });

  test("paid online once (duplicate deliveries ignored); a paid session cancelled without charge is flagged, not refunded", async () => {
    const acc = await individual("i3");
    const cls = await session(acc, 1, start);
    const chargeId = `sc_${cls.id}`;
    await db.collection("gatewayOrders").doc("order_I3").set({ target: { kind: "session", chargeId }, studentId: "i3", amountMinor: 75_000, currency: "INR", status: "created" });
    const p = { orderId: "order_I3", paymentId: "pay_I3", amountMinor: 75_000, currency: "INR", status: "captured", via: "checkout" };
    const outcomes = await Promise.all([processVerifiedGatewayPayment(p), processVerifiedGatewayPayment({ ...p, via: "webhook" })]);
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ["duplicate", "recorded"]);
    assert.equal((await chargeOf(cls)).status, "paid");
    assert.equal((await db.collection("receipts").doc("rzp_pay_I3").get()).exists, true);
    await cancel(cls, "academy", start - H);
    const c = await chargeOf(cls);
    assert.equal(c.status, "no_charge");
    assert.match(c.needsReview, /refund/);
    assert.equal((await db.collection("payments").doc("rzp_pay_I3").get()).get("status"), "paid");
  });
});

describe("gateway processor", () => {
  test("advance: verified once; not-captured and wrong amounts are not recorded", async () => {
    const accountId = await newBatchLearner("g1");
    await db.collection("gatewayOrders").doc("order_G1").set({ target: { kind: "advance", accountId }, studentId: "g1", amountMinor: 40_000, currency: "INR", status: "created" });
    assert.equal((await processVerifiedGatewayPayment({ orderId: "order_G1", paymentId: "pay_G0", amountMinor: 40_000, currency: "INR", status: "authorized", via: "checkout" })).outcome, "not_captured");
    await assert.rejects(processVerifiedGatewayPayment({ orderId: "order_G1", paymentId: "pay_G9", amountMinor: 100, currency: "INR", status: "captured", via: "webhook" }), /does not match/);
    assert.equal((await processVerifiedGatewayPayment({ orderId: "order_G1", paymentId: "pay_G1", amountMinor: 40_000, currency: "INR", status: "captured", via: "webhook" })).outcome, "recorded");
    assert.equal((await account(accountId)).advance.status, "verified");
  });

  test("recovery: a payment for an order that is not yet known fails, and succeeds on retry once it exists", async () => {
    const accountId = await newBatchLearner("g2");
    const p = { orderId: "order_G2", paymentId: "pay_G2", amountMinor: 40_000, currency: "INR", status: "captured", via: "webhook" };
    await assert.rejects(processVerifiedGatewayPayment(p), /unknown order/);
    await db.collection("gatewayOrders").doc("order_G2").set({ target: { kind: "advance", accountId }, studentId: "g2", amountMinor: 40_000, currency: "INR", status: "created" });
    assert.equal((await processVerifiedGatewayPayment(p)).outcome, "recorded");
    assert.equal((await processVerifiedGatewayPayment(p)).outcome, "duplicate");
  });
});

describe("Razorpay Test Mode is isolated from production billing (fail-closed)", () => {
  const saved = {};
  const ENV = ["FIREBASE_ADMIN_PROJECT_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_TEST_FIREBASE_PROJECTS"];
  // Fake TEST credentials generated here: never real keys, and no request ever reaches Razorpay.
  const WEBHOOK_SECRET = `whsec_${randomUUID()}`;
  function useEnv(projectId, allowList = "") {
    for (const k of ENV) if (!(k in saved)) saved[k] = process.env[k];
    Object.assign(process.env, {
      FIREBASE_ADMIN_PROJECT_ID: projectId,
      RAZORPAY_KEY_ID: "rzp_test_FakeKey123",
      RAZORPAY_KEY_SECRET: `fake_${randomUUID()}`,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RAZORPAY_TEST_FIREBASE_PROJECTS: allowList,
    });
  }
  after(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function overdueInvoice(uid) {
    const accountId = await newBatchLearner(uid);
    for (let n = 1; n <= 2; n++) await charge(await makeClass(uid, accountId, n), "attended");
    await billing.generateMonthlyInvoice(accountId, "2026-11", teacher, AFTER_NOV);
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "suspended");
    const invoiceId = `${accountId}_2026-11`;
    const orderId = `order_${uid}${run}`.replace(/[^A-Za-z0-9_]/g, "");
    await db.collection("gatewayOrders").doc(orderId).set({ target: { kind: "invoice", invoiceId }, mode: "test", studentId: uid, amountMinor: 80_000, currency: "INR", status: "created" });
    return { accountId, invoiceId, orderId };
  }
  async function nothingChanged({ accountId, invoiceId }, paymentId) {
    assert.equal((await db.collection("payments").doc(`rzp_${paymentId}`).get()).exists, false, "no payment recorded");
    assert.equal((await db.collection("receipts").doc(`rzp_${paymentId}`).get()).exists, false, "no receipt issued");
    assert.equal((await db.collection("payments").where("invoiceId", "==", invoiceId).get()).size, 0, "invoice not cleared");
    assert.equal((await account(accountId)).suspension.active, true, "suspension not lifted");
  }

  test("production project + test keys: payments disabled, nothing is recorded by any path", async () => {
    const t = await overdueInvoice("tm1");
    useEnv("swaranjanam-prod");
    const razorpay = await import("@/lib/payments/razorpay");
    const gateway = await import("@/lib/lms/server/gateway");
    assert.equal(razorpay.onlinePaymentsEnabled(), false);
    assert.throws(() => razorpay.readRazorpayConfig(), razorpay.GatewayConfigError);
    assert.match(razorpay.onlinePaymentsStatus().reason, /RAZORPAY_TEST_FIREBASE_PROJECTS/);
    // A student cannot even create an order (refused before any network call).
    await assert.rejects(
      gateway.createOrderForStudent({ uid: "tm1", email: null, name: "tm1", role: "student" }, { kind: "invoice", invoiceId: t.invoiceId }),
      razorpay.GatewayConfigError,
    );
    // A "captured" Test Mode payment is refused by the processor itself.
    await assert.rejects(
      processVerifiedGatewayPayment({ orderId: t.orderId, paymentId: "pay_TM1", amountMinor: 80_000, currency: "INR", status: "captured", via: "checkout" }),
      razorpay.GatewayConfigError,
    );
    // A correctly signed webhook is refused too (503) and records nothing.
    const { POST } = await import("@/app/api/payments/razorpay/webhook/route");
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_TM2", order_id: t.orderId, amount: 80_000, currency: "INR", status: "captured" } } } });
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
    const res = await POST(
      new Request("http://localhost/api/payments/razorpay/webhook", { method: "POST", body, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": `evt_${run}` } }),
    );
    assert.equal(res.status, 503);
    assert.equal((await db.collection("gatewayEvents").doc(`evt_${run}`).get()).exists, false);
    await nothingChanged(t, "pay_TM1");
    await nothingChanged(t, "pay_TM2");
  });

  test("a project missing from the allow-list is refused even when other projects are listed", async () => {
    const t = await overdueInvoice("tm2");
    useEnv("swaranjanam-prod", "swaranjanam-staging,another-test");
    await assert.rejects(
      processVerifiedGatewayPayment({ orderId: t.orderId, paymentId: "pay_TM3", amountMinor: 80_000, currency: "INR", status: "captured", via: "webhook" }),
      /not allowed/,
    );
    await nothingChanged(t, "pay_TM3");
  });

  test("an explicitly listed non-production project (and the emulator) may record Test Mode payments, marked as test", async () => {
    const t = await overdueInvoice("tm3");
    useEnv("swaranjanam-staging", "swaranjanam-staging");
    const razorpay = await import("@/lib/payments/razorpay");
    assert.equal(razorpay.onlinePaymentsEnabled(), true);
    const result = await processVerifiedGatewayPayment({ orderId: t.orderId, paymentId: "pay_TM4", amountMinor: 80_000, currency: "INR", status: "captured", via: "webhook" });
    assert.equal(result.outcome, "recorded");
    assert.equal((await db.collection("payments").doc("rzp_pay_TM4").get()).get("gateway.mode"), "test");
    assert.equal((await account(t.accountId)).suspension.active, false);
    useEnv("demo-swaranjanam");
    assert.equal(razorpay.onlinePaymentsEnabled(), true);
  });

  test("an order of another payment mode is never settled by a Test Mode payment", async () => {
    const t = await overdueInvoice("tm4");
    useEnv("demo-swaranjanam");
    await db.collection("gatewayOrders").doc(t.orderId).update({ mode: "live" });
    await assert.rejects(
      processVerifiedGatewayPayment({ orderId: t.orderId, paymentId: "pay_TM5", amountMinor: 80_000, currency: "INR", status: "captured", via: "webhook" }),
      /another payment mode/,
    );
    await nothingChanged(t, "pay_TM5");
  });
});

describe("Firestore security rules (browser access)", () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = (uid) =>
    `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: uid, user_id: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: "password" } })}.`;
  const rest = (path, uid, init = {}) =>
    fetch(`http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
      ...init,
      headers: { ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}), "Content-Type": "application/json", ...(init.headers ?? {}) },
    });

  test("sanity: a student can read their own enrollment (the token mechanism works)", async () => {
    await enroll("r1");
    assert.equal((await rest(`enrollments/${course}_r1`, "r1")).status, 200);
    assert.equal((await rest(`enrollments/${course}_r1`, "someone-else")).status, 403);
  });

  for (const collection of ["billingAccounts", "invoices", "billableClasses", "sessionCharges", "advanceLedger", "legacyDues", "batches", "batchMembers", "payments", "receipts", "gatewayOrders", "settings"]) {
    test(`${collection}: no browser reads, even of a student's own document`, async () => {
      await db.collection(collection).doc("rules-test").set({ studentId: "r2", learnerIds: ["r2"] });
      assert.equal((await rest(`${collection}/rules-test`, "r2")).status, 403);
      assert.equal((await rest(`${collection}/rules-test`, null)).status, 403);
    });
  }

  test("a suspended student cannot read lessons or the course directly; restored access works again", async () => {
    await db.collection("courses").doc(course).set({ title: "Swara Foundation", status: "published", teacherIds: [teacher.uid] }, { merge: true });
    await db.collection("lessons").doc(id("lesson")).set({ courseId: course, moduleId: "m1", order: 1, title: "Lesson", resources: [] });
    await enroll("r5");
    const lesson = `lessons/${id("lesson")}`;
    assert.equal((await rest(lesson, "r5")).status, 200);
    assert.equal((await rest(`courses/${course}`, "r5")).status, 200);
    for (const mode of ["batch", "individual"]) {
      const ref = db.collection("billingAccounts").doc(`ba_r5_${course}_${mode}`);
      await ref.set({ studentId: "r5", courseId: course, mode, status: "active", suspension: { active: true, since: null, invoiceIds: ["x"], liftedAt: null } });
      assert.equal((await rest(lesson, "r5")).status, 403, `${mode} suspended: lesson`);
      assert.equal((await rest(`courses/${course}`, "r5")).status, 403, `${mode} suspended: course`);
      await ref.update({ "suspension.active": false });
      assert.equal((await rest(lesson, "r5")).status, 200, `${mode} restored`);
    }
    // An account without a suspension field (older records) does not block access.
    await db.collection("billingAccounts").doc(`ba_r5_${course}_batch`).set({ studentId: "r5", courseId: course, mode: "batch", status: "active" });
    assert.equal((await rest(lesson, "r5")).status, 200);
    // Other students are still refused.
    assert.equal((await rest(lesson, "someone-else")).status, 403);
  });

  test("no browser writes (a student cannot mark an invoice paid or clear their own old dues)", async () => {
    await db.collection("invoices").doc("rules-write").set({ studentId: "r3", status: "issued" });
    const res = await rest("invoices/rules-write?updateMask.fieldPaths=status", "r3", { method: "PATCH", body: JSON.stringify({ fields: { status: { stringValue: "paid" } } }) });
    assert.equal(res.status, 403);
    const dues = await rest("legacyDues/r3", "r3", { method: "PATCH", body: JSON.stringify({ fields: { status: { stringValue: "cleared" } } }) });
    assert.equal(dues.status, 403);
  });
});

describe("public courses & fees (server catalogue against Firestore)", () => {
  const catalog = () => import("@/lib/catalog/server");
  const write = (slug, data) =>
    db.collection("courses").doc(id(slug)).set({ id: id(slug), slug, title: slug, description: "", status: "published", teacherIds: [teacher.uid], ...data });

  test("only reviewed published courses are listed; approved catalogue fills the gaps; fees come from the billing rates", async () => {
    // Unreviewed template course (published, no availability) and a draft that owns an approved slug.
    await write(`template-${run}`, { availability: null, price: 4999, tag: "Bestseller" });
    await write("little-swaras", { status: "draft", availability: "open" });
    // A teacher-managed open course and a coming-soon course.
    await write(`teacher-open-${run}`, { title: "Teacher course", availability: "open", price: 9999 });
    await write(`teacher-soon-${run}`, { availability: "coming_soon" });
    const { getPublishedCourses, getPublishedCourseBySlug, getPublicFees } = await catalog();

    const result = await getPublishedCourses();
    assert.equal(result.ok, true);
    const bySlug = new Map(result.data.map((c) => [c.slug, c]));
    assert.equal(bySlug.has(`template-${run}`), false, "unreviewed template course hidden");
    assert.equal(bySlug.has("little-swaras"), false, "a draft with an approved slug is not replaced by the fallback");
    assert.equal(bySlug.get("swara-foundation")?.source, "approved", "approved fallback shown");
    assert.deepEqual(bySlug.get(`teacher-open-${run}`)?.fee, { batchMinor: 40_000, individualMinor: 75_000, batchAdvanceMinor: 40_000, siblingDiscount: null });
    assert.equal(bySlug.get(`teacher-soon-${run}`)?.fee, null);
    assert.doesNotMatch(JSON.stringify(result.data), /9999|4999|teacher-1/, "no legacy price or teacher ids");
    assert.deepEqual(await getPublicFees(), bySlug.get("swara-foundation").fee);

    // Detail pages: approved fallback resolves; unreviewed and draft courses do not.
    assert.equal((await getPublishedCourseBySlug("swara-foundation")).data?.title, "Swara Foundation (Adults)");
    assert.equal((await getPublishedCourseBySlug(`template-${run}`)).data, null);
    assert.equal((await getPublishedCourseBySlug("little-swaras")).data, null);
  });

  test("a rate version in force changes the public fees; a future one does not", async () => {
    const { getPublicFees } = await catalog();
    const ref = db.collection("settings").doc("classBilling");
    const before = await ref.get();
    try {
      await ref.set({
        rateVersions: [
          { id: "v1", effectiveFrom: "2026-11", batchMinor: 40_000, individualMinor: 75_000, batchAdvanceMinor: 40_000 },
          { id: "v-past", effectiveFrom: "2026-10", batchMinor: 1, individualMinor: 1, batchAdvanceMinor: 1 },
          { id: "v-future", effectiveFrom: "2099-01", batchMinor: 99_900, individualMinor: 99_900, batchAdvanceMinor: 40_000 },
        ],
      }, { merge: true });
      const fees = await getPublicFees();
      assert.equal(fees.batchMinor, 40_000);
      assert.equal(fees.individualMinor, 75_000);
    } finally {
      if (before.exists) await ref.set(before.data());
      else await ref.delete();
    }
  });

  test("the teacher catalogue form parser accepts availability and never overwrites the legacy price unless sent", async () => {
    const { parseCatalogInput } = await import("@/lib/lms/validation");
    const open = parseCatalogInput({ availability: "open", level: "", category: "", format: "", tag: "" });
    assert.deepEqual(open.errors, {});
    assert.equal(open.value.availability, "open");
    assert.equal("price" in open.value, false);
    assert.equal(parseCatalogInput({ availability: "" }).value.availability, null);
    assert.ok(parseCatalogInput({ availability: "free" }).errors.availability);
  });
});

describe("website enrolment + Razorpay Test Mode checkout (existing payment flow)", () => {
  const ENV = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_TEST_FIREBASE_PROJECTS"];
  const saved = {};
  // Fake TEST credentials, generated here. Razorpay's API is replaced by a local fake below: no network, no real money.
  const KEY_SECRET = `fake_${randomUUID()}`;
  const WEBHOOK_SECRET = `whsec_${randomUUID()}`;
  const realFetch = globalThis.fetch;
  const razorpay = { orders: 0, payments: new Map() };
  const student = (uid) => ({ uid, email: `${uid}@example.test`, name: uid, role: "student" });
  const sign = (orderId, paymentId) => createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  const enrolCourse = id("enrol-course");
  const enrolSlug = `enrol-course-${run}`;

  before(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { RAZORPAY_KEY_ID: "rzp_test_FakeKey123", RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, RAZORPAY_TEST_FIREBASE_PROJECTS: "" });
    // Only api.razorpay.com is faked; the Firestore emulator still uses the real fetch.
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (!u.startsWith("https://api.razorpay.com/")) return realFetch(url, init);
      if (u.endsWith("/v1/orders") && init?.method === "POST") {
        const body = JSON.parse(init.body);
        razorpay.orders++;
        return Response.json({ id: `order_Enr${run.replace(/-/g, "")}${razorpay.orders}`, amount: body.amount, currency: body.currency, receipt: body.receipt, status: "created" });
      }
      const m = u.match(/\/v1\/payments\/(pay_[A-Za-z0-9]+)$/);
      if (m && razorpay.payments.has(m[1])) return Response.json(razorpay.payments.get(m[1]));
      return new Response("{}", { status: 404 });
    };
    await db.collection("courses").doc(enrolCourse).set({ id: enrolCourse, slug: enrolSlug, title: "Enrol Course", description: "", status: "published", availability: "open", teacherIds: [teacher.uid] });
    await db.collection("courses").doc(id("soon-course")).set({ id: id("soon-course"), slug: `soon-course-${run}`, title: "Soon", description: "", status: "published", availability: "coming_soon", teacherIds: [teacher.uid] });
  });
  after(() => {
    globalThis.fetch = realFetch;
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** The academy places the student with the EXISTING tools (old dues, course enrolment, batch). */
  async function placeInBatch(uid) {
    await db.collection("enrollments").doc(`${enrolCourse}_${uid}`).set({ id: `${enrolCourse}_${uid}`, studentId: uid, courseId: enrolCourse, status: "active", agreedFee: null, currency: "INR" });
    await db.collection("legacyDues").doc(uid).set({ studentId: uid, status: "no_previous_dues", note: "test", verifiedBy: teacher.uid, verifiedByEmail: teacher.email, verifiedAt: FieldValue.serverTimestamp() });
    const batchRef = db.collection("batches").doc(id(`enrol-batch-${uid}`));
    await batchRef.set({ name: "Enrol batch", courseId: enrolCourse, courseTitle: "Enrol Course", teacherId: teacher.uid, teacherName: "Teacher", schedule: "Sat", meetUrl: "https://meet.google.com/abc-defg-hij", capacity: 5, memberCount: 0, status: "active" });
    return (await addMemberTx(teacher, batchRef.id, { uid, name: uid })).accountId;
  }
  const paymentsFor = async (accountId) => (await db.collection("payments").where("accountId", "==", accountId).get()).size;

  test("coming-soon, unknown and teacher enrolment attempts are refused; nothing is created", async () => {
    const enrolment = await import("@/lib/lms/server/enrolment");
    await assert.rejects(enrolment.createEnrolmentRequest(student("e0"), { slug: `soon-course-${run}`, mode: "batch", note: "" }), /coming soon/);
    await assert.rejects(enrolment.createEnrolmentRequest(student("e0"), { slug: "voice-culture", mode: "batch", note: "" }), /coming soon/);
    await assert.rejects(enrolment.createEnrolmentRequest(student("e0"), { slug: "no-such-course", mode: "batch", note: "" }), /could not be found/);
    await assert.rejects(enrolment.createEnrolmentRequest({ ...student("t0"), role: "teacher" }, { slug: enrolSlug, mode: "batch", note: "" }), /Only student/);
    await assert.rejects(enrolment.createEnrolmentRequest(student("e0"), { slug: enrolSlug, mode: "monthly-package", note: "" }), /highlighted/);
    assert.equal((await db.collection("enrolmentRequests").where("studentId", "==", "e0").get()).size, 0);
    assert.equal((await db.collection("billingAccounts").where("studentId", "==", "e0").get()).size, 0);
  });

  test("a request is idempotent and creates no billing account, charge or payment", async () => {
    const enrolment = await import("@/lib/lms/server/enrolment");
    const first = await enrolment.createEnrolmentRequest(student("e1"), { slug: enrolSlug, mode: "batch", note: "Saturdays please" });
    assert.equal(first.outcome, "created");
    assert.equal((await enrolment.createEnrolmentRequest(student("e1"), { slug: enrolSlug, mode: "batch", note: "" })).outcome, "already_pending");
    const state = await enrolment.getOwnEnrolmentState(student("e1"), { id: enrolCourse, slug: enrolSlug });
    assert.equal(state.request.status, "pending");
    assert.equal(state.batch, null);
    assert.equal((await db.collection("billingAccounts").where("studentId", "==", "e1").get()).size, 0);
    assert.equal((await db.collection("payments").where("studentId", "==", "e1").get()).size, 0);
    // Teacher handles it; a handled request does not re-open a second account.
    await enrolment.resolveEnrolmentRequest(teacher, first.requestId, "handled", "");
    await assert.rejects(enrolment.resolveEnrolmentRequest(student("e1"), first.requestId, "handled", ""), /Only the academy/);
  });

  test("successful checkout: the ₹400 advance is recorded only after server-side verification", async () => {
    const gateway = await import("@/lib/lms/server/gateway");
    const accountId = await placeInBatch("e2");
    const state = await (await import("@/lib/lms/server/enrolment")).getOwnEnrolmentState(student("e2"), { id: enrolCourse, slug: enrolSlug });
    assert.equal(state.batch.advance.status, "awaiting");
    const order = await gateway.createOrderForStudent(student("e2"), { kind: "advance", accountId });
    assert.equal(order.amountMinor, 40_000, "server-calculated: the advance, never a full course fee");
    assert.equal(order.keyId, "rzp_test_FakeKey123");
    // Opening checkout records nothing.
    assert.equal((await account(accountId)).advance.status, "awaiting");
    razorpay.payments.set("pay_E2ok", { id: "pay_E2ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" });
    const result = await gateway.confirmCheckoutPayment(student("e2"), { orderId: order.orderId, paymentId: "pay_E2ok", signature: sign(order.orderId, "pay_E2ok") });
    assert.equal(result.status, "recorded");
    assert.equal((await account(accountId)).advance.status, "verified");
    assert.equal((await db.collection("receipts").doc("rzp_pay_E2ok").get()).exists, true);
    assert.equal(await paymentsFor(accountId), 1);
  });

  test("cancelled checkout: nothing is recorded, and reopening reuses the same order", async () => {
    const gateway = await import("@/lib/lms/server/gateway");
    const accountId = await placeInBatch("e3");
    const before = razorpay.orders;
    const first = await gateway.createOrderForStudent(student("e3"), { kind: "advance", accountId });
    // The student closes Checkout: no confirmation call, no webhook.
    assert.equal((await account(accountId)).advance.status, "awaiting");
    assert.equal(await paymentsFor(accountId), 0);
    const again = await gateway.createOrderForStudent(student("e3"), { kind: "advance", accountId });
    assert.equal(again.orderId, first.orderId);
    assert.equal(razorpay.orders - before, 1, "one Razorpay order, not one per attempt");
  });

  test("failed verification: bad signature, another student's order, mismatched or uncaptured payment record nothing", async () => {
    const gateway = await import("@/lib/lms/server/gateway");
    const accountId = await placeInBatch("e4");
    const order = await gateway.createOrderForStudent(student("e4"), { kind: "advance", accountId });
    razorpay.payments.set("pay_E4ok", { id: "pay_E4ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" });
    // A browser claiming success with a forged signature.
    await assert.rejects(gateway.confirmCheckoutPayment(student("e4"), { orderId: order.orderId, paymentId: "pay_E4ok", signature: "0".repeat(64) }), /could not be verified/);
    // Someone else's session confirming this order.
    await assert.rejects(gateway.confirmCheckoutPayment(student("intruder"), { orderId: order.orderId, paymentId: "pay_E4ok", signature: sign(order.orderId, "pay_E4ok") }), /could not be verified/);
    // A valid signature for a payment that Razorpay says belongs to another order.
    razorpay.payments.set("pay_E4other", { id: "pay_E4other", order_id: "order_Somethingelse", amount: 40_000, currency: "INR", status: "captured" });
    await assert.rejects(gateway.confirmCheckoutPayment(student("e4"), { orderId: order.orderId, paymentId: "pay_E4other", signature: sign(order.orderId, "pay_E4other") }), /could not be verified/);
    // A failed / not-yet-captured payment.
    razorpay.payments.set("pay_E4fail", { id: "pay_E4fail", order_id: order.orderId, amount: 40_000, currency: "INR", status: "failed" });
    assert.equal((await gateway.confirmCheckoutPayment(student("e4"), { orderId: order.orderId, paymentId: "pay_E4fail", signature: sign(order.orderId, "pay_E4fail") })).status, "processing");
    assert.equal((await account(accountId)).advance.status, "awaiting");
    assert.equal(await paymentsFor(accountId), 0);
  });

  test("duplicate webhook deliveries (and checkout + webhook together) record the advance once", async () => {
    const gateway = await import("@/lib/lms/server/gateway");
    const { POST } = await import("@/app/api/payments/razorpay/webhook/route");
    const accountId = await placeInBatch("e5");
    const order = await gateway.createOrderForStudent(student("e5"), { kind: "advance", accountId });
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_E5ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" } } } });
    const deliver = (eventId) =>
      POST(new Request("http://localhost/api/payments/razorpay/webhook", { method: "POST", body, headers: { "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex"), "x-razorpay-event-id": eventId } }));
    const first = await (await deliver(`evt_E5a${run}`)).json();
    assert.equal(first.outcome, "recorded");
    assert.equal((await (await deliver(`evt_E5a${run}`)).json()).duplicate, true, "same event id redelivered");
    assert.equal((await (await deliver(`evt_E5b${run}`)).json()).outcome, "duplicate", "different event, same payment");
    razorpay.payments.set("pay_E5ok", { id: "pay_E5ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" });
    assert.equal((await gateway.confirmCheckoutPayment(student("e5"), { orderId: order.orderId, paymentId: "pay_E5ok", signature: sign(order.orderId, "pay_E5ok") })).status, "already_recorded");
    // A forged webhook is rejected before anything is read.
    const forged = await POST(new Request("http://localhost/api/payments/razorpay/webhook", { method: "POST", body, headers: { "x-razorpay-signature": "f".repeat(64), "x-razorpay-event-id": `evt_E5c${run}` } }));
    assert.equal(forged.status, 401);
    assert.equal(await paymentsFor(accountId), 1);
    assert.equal((await account(accountId)).advance.status, "verified");
  });

  test("a student with an active billing account cannot open a second request for that course", async () => {
    const enrolment = await import("@/lib/lms/server/enrolment");
    await placeInBatch("e6");
    await assert.rejects(enrolment.createEnrolmentRequest(student("e6"), { slug: enrolSlug, mode: "batch", note: "" }), /already enrolled/);
  });
});
