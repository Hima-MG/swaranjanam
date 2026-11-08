// Firestore EMULATOR integration tests for batches, four-week batch billing cycles,
// individual-session charges, suspension, old-dues clearance, the gateway and
// website registrations (pay first, then batch assignment / individual schedule).
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
const { addMemberTx, createBatchRecord, mapBatch, removeMemberTx, transferMemberTx } = await import("@/lib/lms/server/batches");
const billing = await import("@/lib/lms/server/class-billing");
const { isBillingSuspended } = await import("@/lib/lms/server/access");
const { mapLiveClass } = await import("@/lib/lms/server/classes");
const { processVerifiedGatewayPayment } = await import("@/lib/lms/server/gateway");
const { listOwnClasses } = await import("@/lib/lms/server/classes");
const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

const db = getAdminDb();
const teacher = { uid: "teacher-1", email: "teacher@example.test", name: "Teacher", role: "teacher" };
const run = randomUUID().slice(0, 8);
const id = (s) => `${s}-${run}`;
const course = id("course");
// Weekly Saturday classes from 7 Nov 2026, 7 PM IST: 4 in November, 4 in December, 5 in January 2027.
const WEEK1 = Date.parse("2026-11-07T13:30:00.000Z");
// Monthly invoices may be generated from 23:00 IST on the month's last day.
const NOV_CLOSE = Date.parse("2026-11-30T17:30:00.000Z");
const DEC_CLOSE = Date.parse("2026-12-31T17:30:00.000Z");
const JAN_CLOSE = Date.parse("2027-01-31T17:30:00.000Z");
// November invoice dated 30 Nov → payment deadline 3 Dec 23:59:59.999 IST.
const NOV_DEADLINE_ISO = "2026-12-03T18:29:59.999Z";
const NOV_DEADLINE = Date.parse(NOV_DEADLINE_ISO);
const weekIso = (n, hoursAfter = 0) => new Date(WEEK1 + (n - 1) * 7 * 86_400_000 + hoursAfter * 3_600_000).toISOString();

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
const charge = (cls, outcome, nowIso = "2026-11-30T00:00:00.000Z") =>
  db.runTransaction(async (tx) => {
    const plan = await billing.prepareClassCharge(tx, cls, outcome, nowIso);
    billing.applyClassCharge(tx, plan, teacher);
    return plan.kind;
  });
const account = async (accountId) => billing.mapAccount(await db.collection("billingAccounts").doc(accountId).get());
const monthInvoice = async (accountId, period) => billing.mapInvoice(await db.collection("invoices").doc(`${accountId}_m${period}`).get());
const issue = (accountId, nowIso) => billing.issueDueMonthlyInvoices(accountId, teacher, nowIso);
/** Weekly class n for a student (class 1 on 7 Nov 2026). */
const weekly = (uid, accountId, n) => makeClass(uid, accountId, n, weekIso(n));
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

describe("calendar-month billing", () => {
  test("November: 4 weekly classes (one absent) → invoice on 30 Nov from 23:00 IST; first class deducted once; deadline 3 Dec 23:59 IST", async () => {
    const accountId = await newBatchLearner("b1");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 4; n++) assert.equal(await charge(await weekly("b1", accountId, n), n === 3 ? "absent" : "attended"), "charge");
    const a = await account(accountId);
    assert.equal(a.firstClassId, id("class-b1-1"));
    assert.equal((await db.collection("billableClasses").doc(a.firstClassId).get()).get("coveredBy"), "advance");
    // Not before the last day (23:00 IST).
    assert.deepEqual((await issue(accountId, new Date(NOV_CLOSE - 1).toISOString())).created, []);
    assert.deepEqual((await issue(accountId, new Date(NOV_CLOSE).toISOString())).created, [`${accountId}_m2026-11`]);
    const inv = await monthInvoice(accountId, "2026-11");
    assert.deepEqual(
      [inv.kind, inv.period, inv.invoiceDate, inv.lines.length, inv.subtotalMinor, inv.advanceAppliedMinor, inv.amountDueMinor],
      ["month", "2026-11", "2026-11-30", 4, 160_000, 40_000, 120_000],
    );
    assert.equal(inv.lines.find((l) => l.classId === a.firstClassId).coveredByInitialPayment, true);
    assert.deepEqual([inv.dueAt, inv.deadlineAt], [NOV_DEADLINE_ISO, NOV_DEADLINE_ISO]);
    const after = await account(accountId);
    assert.deepEqual([after.advance.status, after.advance.appliedMinor], ["applied", 40_000]);
    const ledger = (await db.collection("advanceLedger").where("accountId", "==", accountId).get()).docs.map((d) => d.get("kind")).sort();
    assert.deepEqual(ledger, ["applied", "received"]);
  });

  test("December (4 classes) and January (5 classes) are invoiced for exactly the classes held; the initial payment is never deducted again", async () => {
    const accountId = await newBatchLearner("b2");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 13; n++) await charge(await weekly("b2", accountId, n), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    await issue(accountId, new Date(DEC_CLOSE).toISOString());
    await issue(accountId, new Date(JAN_CLOSE).toISOString());
    const [nov, dec, jan] = await Promise.all(["2026-11", "2026-12", "2027-01"].map((p) => monthInvoice(accountId, p)));
    assert.deepEqual([nov.amountDueMinor, dec.amountDueMinor, jan.amountDueMinor], [120_000, 160_000, 200_000]);
    assert.deepEqual([dec.lines.length, jan.lines.length, dec.advanceAppliedMinor, jan.advanceAppliedMinor], [4, 5, 0, 0]);
    assert.equal(jan.invoiceDate, "2027-01-31");
    assert.equal(jan.deadlineAt, "2027-02-03T18:29:59.999Z");
  });

  test("an academy-cancelled class is never charged — the invoice is smaller, never padded; an empty month has no invoice", async () => {
    const accountId = await newBatchLearner("b3");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 4; n++) await charge(await weekly("b3", accountId, n), n === 3 ? "academy_cancelled" : "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    assert.deepEqual([(await monthInvoice(accountId, "2026-11")).lines.length, (await monthInvoice(accountId, "2026-11")).amountDueMinor], [3, 80_000]);
    assert.deepEqual((await issue(accountId, new Date(DEC_CLOSE).toISOString())).created, []);
    assert.equal((await db.collection("invoices").where("accountId", "==", accountId).get()).size, 1);
  });

  test("retried and CONCURRENT generation never duplicates an invoice, a line or the deduction", async () => {
    const accountId = await newBatchLearner("b5");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 4; n++) await charge(await weekly("b5", accountId, n), "attended");
    await Promise.all([1, 2, 3, 4].map(() => issue(accountId, new Date(NOV_CLOSE).toISOString()).catch(() => null)));
    assert.equal((await db.collection("invoices").where("accountId", "==", accountId).get()).size, 1);
    assert.deepEqual((await issue(accountId, new Date(NOV_CLOSE + 60_000).toISOString())).created, []);
    const ledger = (await db.collection("billableClasses").where("accountId", "==", accountId).get()).docs;
    assert.equal(ledger.filter((d) => d.get("invoiceId")).length, 4);
    assert.equal((await db.collection("advanceLedger").where("accountId", "==", accountId).where("kind", "==", "applied").get()).size, 1);
  });

  test("a class recorded after its month's invoice goes on the next month's invoice, once", async () => {
    const accountId = await newBatchLearner("b6");
    await verifyAdvance(accountId);
    for (const n of [1, 2, 4]) await charge(await weekly("b6", accountId, n), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    await charge(await weekly("b6", accountId, 3), "absent"); // 21 Nov, recorded after the November invoice
    for (const n of [5, 6]) await charge(await weekly("b6", accountId, n), "attended");
    await issue(accountId, new Date(DEC_CLOSE).toISOString());
    const dec = await monthInvoice(accountId, "2026-12");
    assert.deepEqual([dec.lines.length, dec.amountDueMinor], [3, 120_000]);
    assert.ok(dec.lines.some((l) => l.classId === id("class-b6-3") && l.period === "2026-11"));
  });

  test("an earlier class recorded after a later one becomes the first class (before invoicing)", async () => {
    const accountId = await newBatchLearner("b7");
    await charge(await weekly("b7", accountId, 2), "attended");
    assert.equal((await account(accountId)).firstClassId, id("class-b7-2"));
    await charge(await weekly("b7", accountId, 1), "attended");
    assert.equal((await account(accountId)).firstClassId, id("class-b7-1"));
    assert.equal((await db.collection("billableClasses").doc(id("class-b7-2")).get()).get("coveredBy"), null);
  });

  test("first-class payment still awaited at month end: the first class waits (never charged twice); deducted once it is paid", async () => {
    const accountId = await newBatchLearner("b13");
    for (let n = 1; n <= 4; n++) await charge(await weekly("b13", accountId, n), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    const nov = await monthInvoice(accountId, "2026-11");
    assert.deepEqual([nov.lines.length, nov.advanceAppliedMinor, nov.amountDueMinor], [3, 0, 120_000]);
    await verifyAdvance(accountId);
    await charge(await weekly("b13", accountId, 5), "attended");
    await issue(accountId, new Date(DEC_CLOSE).toISOString());
    const dec = await monthInvoice(accountId, "2026-12");
    assert.deepEqual([dec.lines.length, dec.subtotalMinor, dec.advanceAppliedMinor, dec.amountDueMinor], [2, 80_000, 40_000, 40_000]);
  });

  test("generated late (job down on the last day): dated when issued, with the full 3-day window", async () => {
    const accountId = await newBatchLearner("b14");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 2; n++) await charge(await weekly("b14", accountId, n), "attended");
    await issue(accountId, "2026-12-02T05:00:00.000Z");
    const inv = await monthInvoice(accountId, "2026-11");
    assert.deepEqual([inv.invoiceDate, inv.deadlineAt], ["2026-12-02", "2026-12-05T18:29:59.999Z"]);
  });

  test("history: an existing four-week cycle invoice is kept as it is and still counts while unpaid", async () => {
    const accountId = await newBatchLearner("b15");
    const checkpoint = "2026-12-04T18:29:59.999Z";
    await db.collection("invoices").doc(`${accountId}_c1`).set({
      kind: "cycle", cycle: 1, accountId, studentId: "b15", courseId: course, courseTitle: "Swara Foundation", studentName: "b15", batchId: null, mode: "batch",
      lines: [], subtotalMinor: 120_000, advanceAppliedMinor: 0, amountDueMinor: 120_000, currency: "INR", status: "issued",
      issuedAt: Timestamp.fromMillis(Date.parse("2026-11-28T15:00:00.000Z")), dueAt: Timestamp.fromMillis(Date.parse(checkpoint)), deadlineAt: Timestamp.fromMillis(Date.parse(checkpoint)),
    });
    const inv = billing.mapInvoice(await db.collection("invoices").doc(`${accountId}_c1`).get());
    assert.deepEqual([inv.kind, inv.deadlineAt, inv.label], ["cycle", checkpoint, "Cycle 1 · weeks 1–4"]);
    assert.equal(await billing.evaluateSuspension(accountId, teacher, Date.parse(checkpoint) + 1), "suspended");
    assert.equal((await db.collection("invoices").doc(`${accountId}_c1`).get()).exists, true, "never deleted");
  });

  test("October 2026 classes are never charged (old payment method)", async () => {
    const accountId = await newBatchLearner("b8");
    assert.equal(await charge(await makeClass("b8", accountId, 1, "2026-10-24T13:30:00.000Z"), "attended"), "none");
    assert.equal((await account(accountId)).billableCount, 0);
  });

  test("re-recording never charges twice; un-billing a charged class is refused", async () => {
    const accountId = await newBatchLearner("b9");
    const cls = await weekly("b9", accountId, 1);
    assert.equal(await charge(cls, "attended"), "charge");
    assert.equal(await charge(cls, "absent"), "already");
    await assert.rejects(charge(cls, "unknown"), /already charged/);
    assert.equal((await account(accountId)).billableCount, 1);
  });

  test("CONCURRENT outcomes for the same class → exactly one charge", async () => {
    const accountId = await newBatchLearner("b10");
    const cls = await weekly("b10", accountId, 1);
    await Promise.all([1, 2, 3, 4].map(() => charge(cls, "attended").catch(() => "conflict")));
    assert.equal((await db.collection("billableClasses").where("accountId", "==", accountId).get()).size, 1);
    assert.equal((await account(accountId)).billableCount, 1);
  });

  test("academy cancellation, rescheduled and unknown create no charge; a student cancellation is billable", async () => {
    const accountId = await newBatchLearner("b11");
    for (const [n, o] of [[1, "academy_cancelled"], [2, "rescheduled"], [3, "unknown"]]) assert.equal(await charge(await weekly("b11", accountId, n), o), "none");
    assert.equal(await charge(await weekly("b11", accountId, 4), "student_cancelled"), "charge");
    assert.equal((await account(accountId)).billableCount, 1);
  });

  test("a legacy package class can never be billed per class", async () => {
    const accountId = await newBatchLearner("b12");
    await assert.rejects(charge({ ...(await weekly("b12", accountId, 1)), packageId: "pkg_legacy" }, "attended"), /prepaid package/);
  });
});

describe("overdue invoice → next class blocked → restored after verified payment", () => {
  /** A class starting a few minutes from now, so its Meet link would be joinable. */
  async function joinableClass(uid, accountId, batch = true) {
    const start = Date.now() + 5 * 60_000;
    const ref = db.collection("liveClasses").doc(id(`join-${uid}`));
    await ref.set({
      studentId: uid, title: "Next class", startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), timeZone: "Asia/Kolkata",
      date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij",
      status: "scheduled", attendance: null, packageId: null, batchId: batch ? id("b") : null, sessionKey: id(`join-${uid}`), billingAccountId: accountId,
    });
  }
  const linkFor = async (uid) => (await listOwnClasses({ uid, email: null, name: uid, role: "student" })).classes.find((c) => c.id === id(`join-${uid}`));
  const pay = async (uid, invoiceId, amountMinor, tag) => {
    await db.collection("gatewayOrders").doc(`order_${tag}`).set({ target: { kind: "invoice", invoiceId }, mode: "test", studentId: uid, amountMinor, currency: "INR", status: "created" });
    return processVerifiedGatewayPayment({ orderId: `order_${tag}`, paymentId: `pay_${tag}`, amountMinor, currency: "INR", status: "captured", via: "webhook" });
  };

  test("no restriction during the 3-day window; overdue after the deadline → no Meet link; verified payment restores it", async () => {
    const accountId = await newBatchLearner("o1");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 4; n++) await charge(await weekly("o1", accountId, n), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    await joinableClass("o1", accountId);
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE), "unchanged"); // still within the window at the last instant
    assert.ok((await linkFor("o1")).meetUrl, "link available before the deadline");
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "suspended");
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "unchanged"); // idempotent
    assert.equal(await isBillingSuspended("o1", course), true);
    const blocked = await linkFor("o1");
    assert.equal(blocked.meetUrl, null, "no Meet link while overdue");
    assert.match(blocked.blockedReason, /unpaid/);
    assert.equal((await account(accountId)).status, "active"); // nothing deleted or closed
    // A partial payment leaves it overdue. (The gateway re-checks at the real clock; re-check at the simulated time.)
    assert.equal((await pay("o1", `${accountId}_m2026-11`, 40_000, "O1a")).outcome, "recorded");
    await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 2);
    assert.equal(await isBillingSuspended("o1", course), true, "partly paid: still restricted");
    assert.equal((await pay("o1", `${accountId}_m2026-11`, 80_000, "O1b")).outcome, "recorded");
    await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 3);
    assert.equal(await isBillingSuspended("o1", course), false);
    assert.ok((await linkFor("o1")).meetUrl, "link restored after verified payment");
  });

  test("two overdue invoices: paying one does not restore access; paying both does", async () => {
    const accountId = await newBatchLearner("o4");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 6; n++) await charge(await weekly("o4", accountId, n), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    await issue(accountId, new Date(DEC_CLOSE).toISOString());
    const decDeadline = Date.parse((await monthInvoice(accountId, "2026-12")).deadlineAt);
    assert.equal(await billing.evaluateSuspension(accountId, teacher, decDeadline + 1), "suspended");
    // (The gateway re-checks at the real clock; re-check at the simulated time.)
    await pay("o4", `${accountId}_m2026-12`, 80_000, "O4a"); // classes 5 and 6
    await billing.evaluateSuspension(accountId, teacher, decDeadline + 2);
    assert.equal((await account(accountId)).suspension.active, true, "November is still overdue");
    await pay("o4", `${accountId}_m2026-11`, 120_000, "O4b");
    await billing.evaluateSuspension(accountId, teacher, decDeadline + 3);
    assert.equal((await account(accountId)).suspension.active, false);
  });

  test("deadline-precise enforcement between scheduled runs (server-side, on access)", async () => {
    const accountId = await newBatchLearner("o5");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 2; n++) await charge(await weekly("o5", accountId, n), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    await billing.enforceOverdueForStudent("o5", NOV_DEADLINE);
    assert.equal((await account(accountId)).suspension.active, false);
    await billing.enforceOverdueForStudent("o5", NOV_DEADLINE + 1);
    assert.equal((await account(accountId)).suspension.active, true);
  });

  test("first-class payment not verified → the first class's Meet link is withheld", async () => {
    const accountId = await newBatchLearner("o2");
    await joinableClass("o2", accountId);
    const blocked = await linkFor("o2");
    assert.equal(blocked.meetUrl, null);
    assert.match(blocked.blockedReason, /initial enrolment payment/);
    await verifyAdvance(accountId);
    assert.ok((await linkFor("o2")).meetUrl);
  });

  test("scheduled job: generates on the last day, suspends after the deadline, idempotent across runs", async () => {
    const accountId = await newBatchLearner("o3");
    await verifyAdvance(accountId);
    for (let n = 1; n <= 3; n++) await charge(await weekly("o3", accountId, n), "attended");
    const first = await billing.runScheduledBilling(teacher, new Date(NOV_CLOSE + 60_000).toISOString());
    assert.ok(first.invoicesCreated >= 1);
    assert.equal((await account(accountId)).suspension.active, false, "no restriction in the payment window");
    const later = await billing.runScheduledBilling(teacher, new Date(NOV_DEADLINE + 60_000).toISOString());
    assert.equal(later.errors, 0);
    assert.equal((await account(accountId)).suspension.active, true);
    assert.equal((await db.collection("invoices").where("accountId", "==", accountId).get()).size, 1);
  });
});

describe("individual sessions (₹750, monthly invoice)", () => {
  async function individual(uid, { prepaid = true } = {}) {
    await enroll(uid);
    const accountId = `ba_${uid}_${course}_individual`;
    await db.collection("billingAccounts").doc(accountId).set({
      studentId: uid, courseId: course, mode: "individual", status: "active", studentName: uid, courseTitle: "Coaching",
      advance: prepaid ? { status: "verified", amountMinor: 75_000, appliedMinor: 0, paymentId: `rzp_pay_${uid}` } : { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null },
      suspension: { active: false },
    });
    return accountId;
  }
  async function session(uid, accountId, n, startIso = weekIso(n)) {
    const start = Date.parse(startIso);
    const ref = db.collection("liveClasses").doc(id(`ind-${uid}-${n}`));
    await ref.set({ studentId: uid, title: `Session ${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", status: "scheduled", packageId: null, batchId: null, billingAccountId: accountId });
    return mapLiveClass(await ref.get());
  }
  const H = 3_600_000;

  test("attended/absent and late student cancellation are billable; unknown, early cancellation and academy cancellation are not", async () => {
    const accountId = await individual("i1");
    const s = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => session("i1", accountId, n)));
    assert.equal(await charge(s[0], "attended"), "charge");
    assert.equal(await charge(s[1], "absent"), "charge");
    assert.equal(await charge(s[2], "unknown"), "none");
    assert.equal(await charge(s[3], "student_cancelled", new Date(Date.parse(s[3].startAt) - 24 * H).toISOString()), "charge"); // any notice: billable
    assert.equal(await charge(s[4], "student_cancelled", new Date(Date.parse(s[4].startAt) - 24 * H + 1).toISOString()), "charge"); // < 24 h
    assert.equal(await charge(s[5], "academy_cancelled", new Date(Date.parse(s[5].startAt) - H).toISOString()), "none");
    await issue(accountId, new Date(DEC_CLOSE).toISOString());
    const inv = await monthInvoice(accountId, "2026-12"); // November and December sessions, all on the first invoice
    // 4 billable sessions × ₹750, the first paid by the ₹750 initial payment.
    assert.deepEqual([inv.mode, inv.lines.length, inv.subtotalMinor, inv.advanceAppliedMinor, inv.amountDueMinor], ["individual", 4, 300_000, 75_000, 225_000]);
  });

  test("an individual account with an overdue invoice is suspended: no Meet link", async () => {
    const accountId = await individual("i4");
    await charge(await session("i4", accountId, 1), "attended");
    await charge(await session("i4", accountId, 2), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "suspended");
    assert.equal(await isBillingSuspended("i4", course), true);
  });

  test("earlier per-session charges stay payable separately and are never billed again on a monthly invoice", async () => {
    const accountId = await individual("i3", { prepaid: false });
    const cls = await session("i3", accountId, 1, "2026-11-20T13:30:00.000Z");
    const chargeId = `sc_${cls.id}`;
    await db.collection("sessionCharges").doc(chargeId).set({ classId: cls.id, accountId, studentId: "i3", learnerIds: ["i3"], courseId: course, courseTitle: "Coaching", title: "Session 1", date: "2026-11-20", startTime: "19:00", startAt: Timestamp.fromMillis(Date.parse(cls.startAt)), amountMinor: 75_000, rateVersionId: "v1", status: "due", paymentId: null, cancelKind: null, needsReview: null });
    assert.equal(await charge(cls, "attended"), "none", "not billed again");
    await db.collection("gatewayOrders").doc("order_I3").set({ target: { kind: "session", chargeId }, studentId: "i3", amountMinor: 75_000, currency: "INR", status: "created" });
    const p = { orderId: "order_I3", paymentId: "pay_I3", amountMinor: 75_000, currency: "INR", status: "captured", via: "checkout" };
    const outcomes = await Promise.all([processVerifiedGatewayPayment(p), processVerifiedGatewayPayment({ ...p, via: "webhook" })]);
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ["duplicate", "recorded"]);
    assert.equal(billing.mapSessionCharge(await db.collection("sessionCharges").doc(chargeId).get()).status, "paid");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    assert.equal(await monthInvoice(accountId, "2026-11"), null);
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
    // First-class payment not yet received: class 1 waits; classes 2 and 3 → ₹800 on the November invoice.
    for (let n = 1; n <= 3; n++) await charge(await weekly(uid, accountId, n), "attended");
    await issue(accountId, new Date(NOV_CLOSE).toISOString());
    assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "suspended");
    const invoiceId = `${accountId}_m2026-11`;
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

  for (const collection of ["billingAccounts", "invoices", "billableClasses", "sessionCharges", "advanceLedger", "legacyDues", "batches", "batchMembers", "payments", "receipts", "gatewayOrders", "settings", "registrations"]) {
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

describe("website registration + Razorpay Test Mode checkout (existing payment flow)", () => {
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
  const otherCourse = id("other-course");
  const otherSlug = `other-course-${run}`;
  const regs = () => import("@/lib/lms/server/registrations");
  const gw = () => import("@/lib/lms/server/gateway");
  const NOW = "2026-11-02T06:00:00.000Z";
  const details = (overrides = {}) => ({
    fullName: "Anjali Menon",
    email: "anjali@example.test",
    mobile: "+919847000000",
    age: "34",
    address: "12 Temple Road, Thrissur",
    preferredDays: ["tue", "sat"],
    preferredTimes: [{ start: "19:00", end: "20:00" }, { start: "07:00", end: "08:00" }],
    notes: "Some prior training",
    ...overrides,
  });
  const registration = async (rid) => (await regs()).mapRegistration(await db.collection("registrations").doc(rid).get());
  const clearDues = (uid) =>
    db.collection("legacyDues").doc(uid).set({ studentId: uid, status: "no_previous_dues", note: "test", verifiedBy: teacher.uid, verifiedByEmail: teacher.email, verifiedAt: FieldValue.serverTimestamp() });
  const SAT_EVENING = { days: ["sat"], start: "19:00", end: "20:00" };
  /** A batch created through the teacher tool's server function (any days and times). */
  const newBatch = (name, { courseId = enrolCourse, weekly: w = SAT_EVENING, capacity = 5, active = true } = {}) =>
    createBatchRecord(teacher, { name: id(name), course: { id: courseId, title: "Enrol Course" }, teacher: { uid: teacher.uid, name: "Teacher" }, weekly: w, meetUrl: "https://meet.google.com/abc-defg-hij", capacity, active });

  /** Registers and pays through the real checkout confirmation (signature + fetched payment, all faked locally). */
  async function registerAndPay(uid, mode = "batch", slug = enrolSlug) {
    const { registrationId } = await (await regs()).saveRegistration(student(uid), { slug, mode, details: details() }, NOW);
    const gateway = await gw();
    const order = await gateway.createOrderForStudent(student(uid), { kind: "registration", registrationId });
    const paymentId = `pay_${uid.replace(/[^A-Za-z0-9]/g, "")}${run.replace(/-/g, "")}`;
    razorpay.payments.set(paymentId, { id: paymentId, order_id: order.orderId, amount: order.amountMinor, currency: "INR", status: "captured" });
    const result = await gateway.confirmCheckoutPayment(student(uid), { orderId: order.orderId, paymentId, signature: sign(order.orderId, paymentId) });
    assert.equal(result.status, "recorded");
    return { registrationId, paymentDocId: `rzp_${paymentId}`, order };
  }

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
        return Response.json({ id: `order_Reg${run.replace(/-/g, "")}${razorpay.orders}`, amount: body.amount, currency: body.currency, receipt: body.receipt, status: "created" });
      }
      const m = u.match(/\/v1\/payments\/(pay_[A-Za-z0-9]+)$/);
      if (m && razorpay.payments.has(m[1])) return Response.json(razorpay.payments.get(m[1]));
      return new Response("{}", { status: 404 });
    };
    for (const [cid, slug] of [[enrolCourse, enrolSlug], [otherCourse, otherSlug]]) {
      await db.collection("courses").doc(cid).set({ id: cid, slug, title: "Enrol Course", description: "", status: "published", availability: "open", teacherIds: [teacher.uid] });
    }
    await db.collection("courses").doc(id("soon-course")).set({ id: id("soon-course"), slug: `soon-course-${run}`, title: "Soon", description: "", status: "published", availability: "coming_soon", teacherIds: [teacher.uid] });
  });
  after(() => {
    globalThis.fetch = realFetch;
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("course selection: coming-soon, unknown, teacher and invalid class-type registrations are refused; nothing is created", async () => {
    const { saveRegistration } = await regs();
    await assert.rejects(saveRegistration(student("rg-g0"), { slug: `soon-course-${run}`, mode: "batch", details: details() }, NOW), /coming soon/);
    await assert.rejects(saveRegistration(student("rg-g0"), { slug: "voice-culture", mode: "batch", details: details() }, NOW), /coming soon/);
    await assert.rejects(saveRegistration(student("rg-g0"), { slug: "no-such-course", mode: "batch", details: details() }, NOW), /could not be found/);
    await assert.rejects(saveRegistration({ ...student("t0"), role: "teacher" }, { slug: enrolSlug, mode: "batch", details: details() }, NOW), /Only student/);
    await assert.rejects(saveRegistration(student("rg-g0"), { slug: enrolSlug, mode: "monthly-package", details: details() }, NOW), /highlighted/);
    assert.equal((await db.collection("registrations").where("studentId", "==", "rg-g0").get()).size, 0);
  });

  test("details validation runs on the server (guardian for under-18s, preferred days and times)", async () => {
    const { saveRegistration } = await regs();
    const err = await saveRegistration(student("rg-g1"), { slug: enrolSlug, mode: "batch", details: details({ age: "", dateOfBirth: "2016-05-20", preferredDays: [], preferredTimes: [] }) }, NOW).catch((e) => e);
    assert.ok(err.fieldErrors.guardianName && err.fieldErrors.preferredDays && err.fieldErrors.preferredTimes);
    assert.equal((await db.collection("registrations").where("studentId", "==", "rg-g1").get()).size, 0);
  });

  test("one registration per student and course; the initial amount is server-calculated (batch ₹400, individual ₹750); no payment or billing records", async () => {
    const { saveRegistration, getOwnRegistration } = await regs();
    const first = await saveRegistration(student("rg-g2"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
    assert.deepEqual([first.outcome, first.initialAmountMinor], ["created", 40_000]);
    const second = await saveRegistration(student("rg-g2"), { slug: enrolSlug, mode: "individual", details: details({ notes: "changed" }) }, NOW);
    assert.deepEqual([second.registrationId, second.outcome, second.initialAmountMinor], [first.registrationId, "updated", 75_000]);
    const own = await getOwnRegistration(student("rg-g2"), enrolSlug);
    assert.deepEqual([own.status, own.mode, own.details.preferredDays, own.details.preferredTimes.length], ["pending_payment", "individual", ["tue", "sat"], 2]);
    assert.equal((await db.collection("registrations").where("studentId", "==", "rg-g2").get()).size, 1);
    for (const c of ["billingAccounts", "payments", "enrollments"]) assert.equal((await db.collection(c).where("studentId", "==", "rg-g2").get()).size, 0, c);
  });

  test("successful checkout: paid only after server-side verification → 'Paid — Awaiting Batch Assignment'; no duplicate registration or payment", async () => {
    const { saveRegistration, getOwnRegistration } = await regs();
    const { registrationId } = await saveRegistration(student("rg-g3"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
    const gateway = await gw();
    const order = await gateway.createOrderForStudent(student("rg-g3"), { kind: "registration", registrationId });
    assert.equal(order.amountMinor, 40_000, "server-calculated: the first class, never a course total");
    assert.equal((await registration(registrationId)).status, "pending_payment", "opening checkout records nothing");
    razorpay.payments.set("pay_G3ok", { id: "pay_G3ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" });
    assert.equal((await gateway.confirmCheckoutPayment(student("rg-g3"), { orderId: order.orderId, paymentId: "pay_G3ok", signature: sign(order.orderId, "pay_G3ok") })).status, "recorded");
    const r = await getOwnRegistration(student("rg-g3"), enrolSlug);
    assert.deepEqual([r.status, r.paymentId], ["paid", "rzp_pay_G3ok"]);
    const { registrationStatusLabel } = await import("@/lib/lms/registration");
    assert.equal(registrationStatusLabel(r.status, r.mode), "Paid — Awaiting Batch Assignment");
    const pay = (await db.collection("payments").doc("rzp_pay_G3ok").get()).data();
    assert.deepEqual([pay.purpose, pay.registrationId, pay.accountId, pay.verified, pay.amountMinor], ["registration", registrationId, null, true, 40_000]);
    // No second registration, no second payment.
    await assert.rejects(saveRegistration(student("rg-g3"), { slug: enrolSlug, mode: "batch", details: details() }, NOW), /already registered and paid/);
    await assert.rejects(gateway.createOrderForStudent(student("rg-g3"), { kind: "registration", registrationId }), /Nothing is payable/);
    assert.equal((await db.collection("payments").where("registrationId", "==", registrationId).get()).size, 1);
  });

  test("cancelled checkout leaves a recoverable pending registration; retry reuses the order; a later payment succeeds", async () => {
    const { saveRegistration } = await regs();
    const gateway = await gw();
    const { registrationId } = await saveRegistration(student("rg-g4"), { slug: enrolSlug, mode: "individual", details: details() }, NOW);
    const before = razorpay.orders;
    const first = await gateway.createOrderForStudent(student("rg-g4"), { kind: "registration", registrationId });
    // The student closes Checkout: no confirmation call, no webhook.
    assert.equal((await registration(registrationId)).status, "pending_payment");
    const again = await gateway.createOrderForStudent(student("rg-g4"), { kind: "registration", registrationId });
    assert.equal(again.orderId, first.orderId);
    assert.equal(razorpay.orders - before, 1, "one Razorpay order, not one per attempt");
    razorpay.payments.set("pay_G4ok", { id: "pay_G4ok", order_id: again.orderId, amount: 75_000, currency: "INR", status: "captured" });
    await gateway.confirmCheckoutPayment(student("rg-g4"), { orderId: again.orderId, paymentId: "pay_G4ok", signature: sign(again.orderId, "pay_G4ok") });
    const r = await registration(registrationId);
    assert.equal(r.status, "paid");
    const { registrationStatusLabel } = await import("@/lib/lms/registration");
    assert.equal(registrationStatusLabel(r.status, r.mode), "Paid — Awaiting Schedule Confirmation");
  });

  test("failed verification: forged signature, another student, mismatched or failed payment record nothing", async () => {
    const { saveRegistration } = await regs();
    const gateway = await gw();
    const { registrationId } = await saveRegistration(student("rg-g5"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
    const order = await gateway.createOrderForStudent(student("rg-g5"), { kind: "registration", registrationId });
    razorpay.payments.set("pay_G5ok", { id: "pay_G5ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" });
    await assert.rejects(gateway.confirmCheckoutPayment(student("rg-g5"), { orderId: order.orderId, paymentId: "pay_G5ok", signature: "0".repeat(64) }), /could not be verified/);
    await assert.rejects(gateway.confirmCheckoutPayment(student("intruder"), { orderId: order.orderId, paymentId: "pay_G5ok", signature: sign(order.orderId, "pay_G5ok") }), /could not be verified/);
    await assert.rejects(gateway.createOrderForStudent(student("intruder"), { kind: "registration", registrationId }), /could not be found/);
    razorpay.payments.set("pay_G5other", { id: "pay_G5other", order_id: "order_Somethingelse", amount: 40_000, currency: "INR", status: "captured" });
    await assert.rejects(gateway.confirmCheckoutPayment(student("rg-g5"), { orderId: order.orderId, paymentId: "pay_G5other", signature: sign(order.orderId, "pay_G5other") }), /could not be verified/);
    razorpay.payments.set("pay_G5fail", { id: "pay_G5fail", order_id: order.orderId, amount: 40_000, currency: "INR", status: "failed" });
    assert.equal((await gateway.confirmCheckoutPayment(student("rg-g5"), { orderId: order.orderId, paymentId: "pay_G5fail", signature: sign(order.orderId, "pay_G5fail") })).status, "processing");
    assert.equal((await registration(registrationId)).status, "pending_payment", "still recoverable");
    assert.equal((await db.collection("payments").where("registrationId", "==", registrationId).get()).size, 0);
  });

  test("duplicate webhook deliveries (and checkout + webhook together) record the payment once", async () => {
    const { saveRegistration } = await regs();
    const gateway = await gw();
    const { POST } = await import("@/app/api/payments/razorpay/webhook/route");
    const { registrationId } = await saveRegistration(student("rg-g6"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
    const order = await gateway.createOrderForStudent(student("rg-g6"), { kind: "registration", registrationId });
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_G6ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" } } } });
    const deliver = (eventId, signature = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")) =>
      POST(new Request("http://localhost/api/payments/razorpay/webhook", { method: "POST", body, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } }));
    assert.equal((await (await deliver(`evt_G6a${run}`)).json()).outcome, "recorded");
    assert.equal((await (await deliver(`evt_G6a${run}`)).json()).duplicate, true, "same event id redelivered");
    assert.equal((await (await deliver(`evt_G6b${run}`)).json()).outcome, "duplicate", "different event, same payment");
    razorpay.payments.set("pay_G6ok", { id: "pay_G6ok", order_id: order.orderId, amount: 40_000, currency: "INR", status: "captured" });
    assert.equal((await gateway.confirmCheckoutPayment(student("rg-g6"), { orderId: order.orderId, paymentId: "pay_G6ok", signature: sign(order.orderId, "pay_G6ok") })).status, "already_recorded");
    assert.equal((await deliver(`evt_G6c${run}`, "f".repeat(64))).status, 401, "forged webhook rejected");
    assert.equal((await db.collection("payments").where("registrationId", "==", registrationId).get()).size, 1);
    assert.equal((await registration(registrationId)).status, "paid");
  });

  test("a stale order (class type changed after checkout opened) is never applied short: flagged for review, registration stays pending", async () => {
    const { saveRegistration } = await regs();
    const gateway = await gw();
    const { registrationId } = await saveRegistration(student("rg-g7"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
    const stale = await gateway.createOrderForStudent(student("rg-g7"), { kind: "registration", registrationId });
    await saveRegistration(student("rg-g7"), { slug: enrolSlug, mode: "individual", details: details() }, NOW);
    const fresh = await gateway.createOrderForStudent(student("rg-g7"), { kind: "registration", registrationId });
    assert.notEqual(fresh.orderId, stale.orderId);
    assert.equal(fresh.amountMinor, 75_000);
    const result = await processVerifiedGatewayPayment({ orderId: stale.orderId, paymentId: "pay_G7stale", amountMinor: 40_000, currency: "INR", status: "captured", via: "webhook" });
    assert.match(result.needsReview, /less than the amount now due/);
    assert.equal((await registration(registrationId)).status, "pending_payment");
  });

  test("a student already in a batch for the course cannot register again", async () => {
    const batchId = await newBatch("existing");
    await db.collection("enrollments").doc(`${enrolCourse}_rg-g8`).set({ id: `${enrolCourse}_rg-g8`, studentId: "rg-g8", courseId: enrolCourse, status: "active", agreedFee: null, currency: "INR" });
    await clearDues("rg-g8");
    await addMemberTx(teacher, batchId, { uid: "rg-g8", name: "rg-g8" });
    await assert.rejects((await regs()).saveRegistration(student("rg-g8"), { slug: enrolSlug, mode: "batch", details: details() }, NOW), /already enrolled/);
  });

  describe("teacher: batches and assignment", () => {
    test("batch creation stores any days/times, capacity and active flag", async () => {
      const batchId = await newBatch("created", { weekly: { days: ["sun", "wed"], start: "06:30", end: "07:15" }, capacity: 3, active: false });
      const b = mapBatch(await db.collection("batches").doc(batchId).get());
      assert.deepEqual([b.weekly, b.schedule, b.capacity, b.status, b.memberCount], [{ days: ["wed", "sun"], start: "06:30", end: "07:15" }, "Wednesday & Sunday, 06:30–07:15 IST", 3, "archived", 0]);
      await assert.rejects(createBatchRecord(student("x"), { name: "x", course: { id: enrolCourse, title: "x" }, teacher: { uid: "t", name: "t" }, weekly: SAT_EVENING, meetUrl: null, capacity: 5, active: true }), /Only the academy/);
    });

    test("assignment is refused before payment, for individual registrations, other courses, inactive or full batches and schedule conflicts", async () => {
      const { saveRegistration, assignRegistrationToBatch } = await regs();
      const batchId = await newBatch("checks");
      // Unpaid.
      const unpaid = await saveRegistration(student("rg-h1"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
      await clearDues("rg-h1");
      await assert.rejects(assignRegistrationToBatch(teacher, unpaid.registrationId, batchId), /not been verified/);
      // Individual registration → never a batch.
      const ind = await registerAndPay("rg-h2", "individual");
      await clearDues("rg-h2");
      await assert.rejects(assignRegistrationToBatch(teacher, ind.registrationId, batchId), /individual-class registration/);
      // Batch of another course.
      const paid = await registerAndPay("rg-h3");
      await clearDues("rg-h3");
      await assert.rejects(assignRegistrationToBatch(teacher, paid.registrationId, await newBatch("other", { courseId: otherCourse })), /different course/);
      // Inactive batch.
      await assert.rejects(assignRegistrationToBatch(teacher, paid.registrationId, await newBatch("inactive", { active: false })), /inactive/);
      // Full batch.
      const full = await newBatch("full", { capacity: 1 });
      const filler = await registerAndPay("rg-h4");
      await clearDues("rg-h4");
      await assignRegistrationToBatch(teacher, filler.registrationId, full);
      await assert.rejects(assignRegistrationToBatch(teacher, paid.registrationId, full), /full/i);
      // Schedule conflict with the student's batch in another course (Saturday 19:00–20:00 vs 19:30–20:30).
      const otherBatch = await newBatch("h3-other", { courseId: otherCourse });
      await db.collection("enrollments").doc(`${otherCourse}_rg-h3`).set({ id: `${otherCourse}_rg-h3`, studentId: "rg-h3", courseId: otherCourse, status: "active", agreedFee: null, currency: "INR" });
      await addMemberTx(teacher, otherBatch, { uid: "rg-h3", name: "rg-h3" });
      await assert.rejects(assignRegistrationToBatch(teacher, paid.registrationId, await newBatch("clash", { weekly: { days: ["sat"], start: "19:30", end: "20:30" } })), /Schedule conflict/);
      // Back-to-back is fine.
      await assignRegistrationToBatch(teacher, paid.registrationId, await newBatch("after", { weekly: { days: ["sat"], start: "20:00", end: "21:00" } }));
      // Students cannot assign.
      await assert.rejects(assignRegistrationToBatch(student("rg-h3"), paid.registrationId, batchId), /Only the academy/);
    });

    test("assignment: enrolment + account with the initial payment as the verified first-class payment; class 1 never invoiced; cycles and overdue blocking still apply", async () => {
      const { assignRegistrationToBatch, getOwnRegistration, listOwnRegistrations } = await regs();
      const batchId = await newBatch("assign");
      const { registrationId, paymentDocId } = await registerAndPay("rg-h5");
      await clearDues("rg-h5");
      const { accountId } = await assignRegistrationToBatch(teacher, registrationId, batchId);
      await assert.rejects(assignRegistrationToBatch(teacher, registrationId, batchId), /already been placed/);
      const r = await getOwnRegistration(student("rg-h5"), enrolSlug);
      assert.deepEqual([r.status, r.batchId, r.accountId], ["assigned", batchId, accountId]);
      assert.equal((await listOwnRegistrations(student("rg-h5")))[0].status, "assigned");
      assert.equal((await db.collection("enrollments").doc(`${enrolCourse}_rg-h5`).get()).get("status"), "active");
      const a = await account(accountId);
      assert.deepEqual([a.mode, a.advance.status, a.advance.amountMinor, a.advance.paymentId], ["batch", "verified", 40_000, paymentDocId]);
      assert.equal((await db.collection("payments").doc(paymentDocId).get()).get("accountId"), accountId);
      assert.equal((await db.collection("batches").doc(batchId).get()).get("memberCount"), 1);
      // Monthly billing: class 1 is listed with the initial payment deducted (once).
      for (let n = 1; n <= 4; n++) await charge(await weekly("rg-h5", accountId, n), "attended");
      await issue(accountId, new Date(NOV_CLOSE).toISOString());
      const inv = await monthInvoice(accountId, "2026-11");
      assert.deepEqual([inv.lines.length, inv.subtotalMinor, inv.advanceAppliedMinor, inv.amountDueMinor], [4, 160_000, 40_000, 120_000]);
      assert.equal(inv.lines.find((l) => l.classId === id("class-rg-h5-1"))?.coveredByInitialPayment, true, "class 1 paid by the initial payment");
      // The initial payment never bypasses later overdue restrictions.
      assert.equal(await billing.evaluateSuspension(accountId, teacher, NOV_DEADLINE + 1), "suspended");
      assert.equal(await isBillingSuspended("rg-h5", enrolCourse), true);
    });

    test("individual: schedule confirmed (no batch); the ₹750 initial payment is deducted on the first monthly invoice", async () => {
      const { confirmIndividualSchedule, assignRegistrationToBatch } = await regs();
      const { registrationId, paymentDocId } = await registerAndPay("rg-h6", "individual");
      await clearDues("rg-h6");
      await assert.rejects(confirmIndividualSchedule(teacher, registrationId, { days: [], start: "19:00", end: "20:00", note: "" }), /highlighted/);
      const { accountId, schedule } = await confirmIndividualSchedule(teacher, registrationId, { days: ["wed"], start: "18:00", end: "19:00", note: "" });
      assert.equal(schedule, "Wednesday, 18:00–19:00 IST");
      await assert.rejects(confirmIndividualSchedule(teacher, registrationId, { days: ["wed"], start: "18:00", end: "19:00", note: "" }), /already been scheduled/);
      await assert.rejects(assignRegistrationToBatch(teacher, registrationId, await newBatch("ind")), /individual-class registration/);
      const r = await registration(registrationId);
      assert.deepEqual([r.status, r.batchId, r.confirmedSchedule], ["scheduled", null, schedule]);
      const acc = await account(accountId);
      assert.deepEqual([acc.mode, acc.advance.status, acc.advance.amountMinor, acc.advance.paymentId], ["individual", "verified", 75_000, paymentDocId]);
      // Sessions held and recorded → monthly invoice: 2 × ₹750 − ₹750 initial payment.
      for (let n = 1; n <= 2; n++) {
        const ref = db.collection("liveClasses").doc(id(`rg-h6-${n}`));
        const start = WEEK1 + n * 86_400_000;
        await ref.set({ studentId: "rg-h6", title: `S${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "18:00", endTime: "19:00", meetUrl: null, status: "scheduled", packageId: null, batchId: null, billingAccountId: accountId });
        assert.equal(await charge(mapLiveClass(await ref.get()), "attended"), "charge");
      }
      assert.equal((await db.collection("sessionCharges").where("accountId", "==", accountId).get()).size, 0, "no upfront per-session charges");
      await issue(accountId, new Date(NOV_CLOSE).toISOString());
      const inv = await monthInvoice(accountId, "2026-11");
      assert.deepEqual([inv.lines.length, inv.subtotalMinor, inv.advanceAppliedMinor, inv.amountDueMinor], [2, 150_000, 75_000, 75_000]);
      // Schedule changes are recorded; preferences are never treated as bookings; only academy accounts can teach.
      const { updateIndividualSchedule } = await regs();
      await assert.rejects(updateIndividualSchedule(teacher, registrationId, { days: ["fri"], start: "17:00", end: "18:00", note: "", teacherId: "rg-h6" }), /highlighted/);
      await assert.rejects(updateIndividualSchedule(student("rg-h6"), registrationId, { days: ["fri"], start: "17:00", end: "18:00", note: "" }), /Only the academy/);
      await db.collection("users").doc("teacher-2").set({ role: "teacher", displayName: "Second Teacher" });
      const changed = await updateIndividualSchedule(teacher, registrationId, { days: ["fri"], start: "17:00", end: "18:00", note: "", teacherId: "teacher-2" });
      assert.equal(changed.previous, schedule);
      const after = await registration(registrationId);
      assert.deepEqual([after.confirmedSchedule, after.scheduleTeacherName, after.weeklySchedule.days], ["Friday, 17:00–18:00 IST", "Second Teacher", ["fri"]]);
      assert.ok(after.history.some((h) => /Schedule changed from/.test(h.change)));
    });
  });

  describe("course-specific pricing and agreed rates", () => {
    const priced = id("priced-course");
    const pricedSlug = `priced-course-${run}`;
    const batchOnlySlug = `batch-only-${run}`;
    const closedSlug = `closed-course-${run}`;
    const pricing = (batchMinor, individualMinor) => ({ batchEnabled: batchMinor !== null, batchMinor, individualEnabled: individualMinor !== null, individualMinor, batchCapacity: 5, currency: "INR" });
    const pricingLib = () => import("@/lib/lms/server/course-pricing");

    before(async () => {
      await db.collection("courses").doc(priced).set({ id: priced, slug: pricedSlug, title: "Priced Course", description: "", status: "published", availability: "open", teacherIds: [teacher.uid], pricing: pricing(35_000, 60_000) });
      await db.collection("courses").doc(id("batch-only")).set({ id: id("batch-only"), slug: batchOnlySlug, title: "Batch Only", description: "", status: "published", availability: "open", teacherIds: [teacher.uid], pricing: pricing(50_000, null) });
      await db.collection("courses").doc(id("closed-course")).set({ id: id("closed-course"), slug: closedSlug, title: "Closed", description: "", status: "published", availability: "closed", teacherIds: [teacher.uid] });
    });

    test("the public course and the initial payment use the course's OWN rates (₹350 / ₹600), calculated on the server", async () => {
      const { getPublishedCourseBySlug } = await import("@/lib/catalog/server");
      const course = (await getPublishedCourseBySlug(pricedSlug)).data;
      assert.deepEqual([course.fee.batchMinor, course.fee.individualMinor], [35_000, 60_000]);
      const { saveRegistration } = await regs();
      assert.equal((await saveRegistration(student("cp-1"), { slug: pricedSlug, mode: "batch", details: details() }, NOW)).initialAmountMinor, 35_000);
      assert.equal((await saveRegistration(student("cp-2"), { slug: pricedSlug, mode: "individual", details: details() }, NOW)).initialAmountMinor, 60_000);
      // Whatever the browser sends, the amount comes from the course.
      const r = await registration(`cp-1_${pricedSlug}`);
      assert.deepEqual([r.rateMinor, r.initialAmountMinor], [35_000, 35_000]);
      const order = await (await gw()).createOrderForStudent(student("cp-1"), { kind: "registration", registrationId: r.id });
      assert.equal(order.amountMinor, 35_000);
    });

    test("only offered class types can be chosen; closed and coming-soon courses take no new enrolments", async () => {
      const { saveRegistration } = await regs();
      const { getPublishedCourseBySlug } = await import("@/lib/catalog/server");
      assert.equal((await getPublishedCourseBySlug(batchOnlySlug)).data.fee.individualMinor, null);
      const err = await saveRegistration(student("cp-3"), { slug: batchOnlySlug, mode: "individual", details: details() }, NOW).catch((e) => e);
      assert.match(err.fieldErrors.mode, /not offered/);
      await assert.rejects(saveRegistration(student("cp-3"), { slug: closedSlug, mode: "batch", details: details() }, NOW), /closed for new enrolments/);
      assert.equal((await getPublishedCourseBySlug(closedSlug)).data.fee, null, "closed: public details, no fees or Enrol Now");
    });

    test("the agreed rate is fixed at enrolment: a later course price change affects new students only", async () => {
      const { assignRegistrationToBatch } = await regs();
      const batchId = await newBatch("priced", { courseId: priced });
      const { registrationId } = await registerAndPay("cp-4", "batch", pricedSlug);
      await clearDues("cp-4");
      const { accountId } = await assignRegistrationToBatch(teacher, registrationId, batchId);
      assert.deepEqual((await account(accountId)).agreedRates, [{ effectiveFrom: "2026-11", rateMinor: 35_000 }]);
      assert.equal((await account(accountId)).advance.amountMinor, 35_000);
      // The academy raises the course price.
      await (await pricingLib()).saveCoursePricing(teacher, priced, { batchEnabled: "on", batchPrice: "500", individualEnabled: "on", individualPrice: "800" });
      await assert.rejects((await pricingLib()).saveCoursePricing(student("cp-4"), priced, { batchEnabled: "on", batchPrice: "1" }), /Only the academy/);
      // Course B example: 5 classes in January × ₹350 = ₹1,750 − ₹350 initial payment = ₹1,400.
      for (let n = 9; n <= 13; n++) assert.equal(await charge(await weekly("cp-4", accountId, n), "attended"), "charge");
      await issue(accountId, new Date(JAN_CLOSE).toISOString());
      const jan = await monthInvoice(accountId, "2027-01");
      assert.deepEqual([jan.lines.length, jan.subtotalMinor, jan.advanceAppliedMinor, jan.amountDueMinor], [5, 175_000, 35_000, 140_000]);
      assert.ok(jan.lines.every((l) => l.rateMinor === 35_000 && l.rateVersionId === "agreed"));
      // A new student gets the new price.
      const { saveRegistration } = await regs();
      assert.equal((await saveRegistration(student("cp-5"), { slug: pricedSlug, mode: "batch", details: details() }, NOW)).initialAmountMinor, 50_000);
      const course = (await db.collection("courses").doc(priced).get()).data();
      assert.ok(course.pricingHistory.some((h) => h.scope === "new_students" && h.to.batchMinor === 50_000));
    });

    test("an approved change for enrolled students applies from a future month; earlier classes and issued invoices never change", async () => {
      const { assignRegistrationToBatch } = await regs();
      const lib = await pricingLib();
      const batchId = await newBatch("priced-2", { courseId: priced });
      const { registrationId } = await registerAndPay("cp-6", "batch", pricedSlug);
      await clearDues("cp-6");
      const { accountId } = await assignRegistrationToBatch(teacher, registrationId, batchId);
      const agreed = (await account(accountId)).agreedRates[0].rateMinor; // the price when cp-6 registered
      for (let n = 1; n <= 2; n++) await charge(await weekly("cp-6", accountId, n), "attended");
      await issue(accountId, new Date(NOV_CLOSE).toISOString());
      const novBefore = await monthInvoice(accountId, "2026-11");
      const input = { mode: "batch", rate: "450", effectiveFrom: "2026-12", reason: "Annual revision approved", confirm: true };
      const nov15 = "2026-11-15T06:00:00.000Z";
      await assert.rejects(lib.changeEnrolledRates(student("cp-6"), priced, input, nov15), /Only the academy/);
      await assert.rejects(lib.changeEnrolledRates(teacher, priced, { ...input, effectiveFrom: "2026-11" }, nov15), /highlighted/);
      await assert.rejects(lib.changeEnrolledRates(teacher, priced, { ...input, confirm: false }, nov15), /highlighted/);
      const r = await lib.changeEnrolledRates(teacher, priced, input, nov15);
      assert.ok(r.accounts >= 1);
      await charge(await weekly("cp-6", accountId, 5), "attended"); // 5 Dec
      await issue(accountId, new Date(DEC_CLOSE).toISOString());
      const dec = await monthInvoice(accountId, "2026-12");
      assert.deepEqual([dec.lines.length, dec.amountDueMinor], [1, 45_000]);
      const novAfter = await monthInvoice(accountId, "2026-11");
      assert.deepEqual([novAfter.amountDueMinor, novAfter.lines.map((l) => l.rateMinor)], [novBefore.amountDueMinor, [agreed, agreed]], "historical invoice unchanged");
      await assert.rejects(lib.changeEnrolledRates(teacher, priced, input, nov15), /already starts that month/);
    });

    test("an existing student enrolling in a second course gets a separate registration, account and agreed rate", async () => {
      const { saveRegistration } = await regs();
      const first = await saveRegistration(student("cp-7"), { slug: pricedSlug, mode: "batch", details: details() }, NOW);
      const second = await saveRegistration(student("cp-7"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
      assert.notEqual(first.registrationId, second.registrationId);
      assert.deepEqual([first.initialAmountMinor, second.initialAmountMinor], [50_000, 40_000]);
    });
  });

  describe("guest enrolment → verified payment → student account (Auth emulator)", () => {
    const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const guestLib = () => import("@/lib/lms/server/guest-enrolment");
    const savedKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    before(() => {
      // The Auth emulator accepts any API key; no real key is used.
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "fake-api-key-for-emulator";
    });
    after(() => {
      if (savedKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
      else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = savedKey;
    });
    const guestDetails = (email) => details({ email, fullName: "Guest Learner" });
    const oobCodes = async (email) =>
      ((await (await realFetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json()).oobCodes ?? []).filter((c) => c.email === email);
    async function guestPay(email, slug = enrolSlug, via = "checkout") {
      const g = await guestLib();
      const saved = await g.saveGuestRegistration({ slug, mode: "batch", details: guestDetails(email) }, null, NOW);
      const gateway = await gw();
      const order = await gateway.createOrderForGuest(saved.registrationId, saved.token);
      const paymentId = `pay_G${saved.registrationId.slice(2, 14)}${run.replace(/-/g, "")}`;
      razorpay.payments.set(paymentId, { id: paymentId, order_id: order.orderId, amount: order.amountMinor, currency: "INR", status: "captured" });
      if (via === "checkout") {
        const r = await gateway.confirmGuestCheckoutPayment(saved.registrationId, saved.token, { orderId: order.orderId, paymentId, signature: sign(order.orderId, paymentId) });
        assert.equal(r.status, "recorded");
      } else {
        await processVerifiedGatewayPayment({ orderId: order.orderId, paymentId, amountMinor: order.amountMinor, currency: "INR", status: "captured", via: "webhook" });
      }
      return { ...saved, order, paymentDocId: `rzp_${paymentId}` };
    }

    test("a guest registers without an account; only the hash of the checkout token is stored; the token is required to read it", async () => {
      const g = await guestLib();
      const saved = await g.saveGuestRegistration({ slug: enrolSlug, mode: "batch", details: guestDetails(`guest1-${run}@example.test`) }, null, NOW);
      const doc = (await db.collection("registrations").doc(saved.registrationId).get()).data();
      assert.deepEqual([doc.studentId, doc.status, doc.initialAmountMinor], [null, "pending_payment", 40_000]);
      assert.notEqual(doc.guestTokenHash, saved.token);
      assert.equal(JSON.stringify(doc).includes(saved.token), false, "token never stored");
      assert.ok(await g.readGuestRegistration(saved.registrationId, saved.token));
      assert.equal(await g.readGuestRegistration(saved.registrationId, "x".repeat(43)), null);
      // Same email + course → same registration (no duplicate); another browser gets a new token, the old one stops working.
      const again = await g.saveGuestRegistration({ slug: enrolSlug, mode: "batch", details: guestDetails(`GUEST1-${run}@example.test`) }, null, NOW);
      assert.equal(again.registrationId, saved.registrationId);
      assert.equal(await g.readGuestRegistration(saved.registrationId, saved.token), null);
      // Orders need the current token; a signed-in student cannot pay someone else's guest registration.
      const gateway = await gw();
      await assert.rejects(gateway.createOrderForGuest(saved.registrationId, saved.token), /could not be found/);
      await assert.rejects(gateway.createOrderForStudent(student("rg-intruder"), { kind: "registration", registrationId: saved.registrationId }), /could not be found/);
      assert.equal((await gateway.createOrderForGuest(again.registrationId, again.token)).amountMinor, 40_000);
    });

    test("verified payment → a student account is created server-side (role student), linked, and a password-setup email is sent", async () => {
      const email = `guest2-${run}@example.test`;
      const { registrationId, paymentDocId } = await guestPay(email);
      const r = await registration(registrationId);
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      const user = await getAdminAuth().getUserByEmail(email);
      assert.equal(r.status, "paid");
      assert.equal(r.studentId, user.uid);
      assert.equal(user.uid, (await guestLib()).provisionedUid(email));
      assert.equal(user.customClaims?.role, undefined, "no teacher claim: student");
      assert.equal((await db.collection("users").doc(user.uid).get()).get("role"), "student");
      assert.equal((await db.collection("payments").doc(paymentDocId).get()).get("studentId"), user.uid, "payment history belongs to the new student");
      const codes = await oobCodes(email);
      assert.equal(codes.length, 1);
      assert.equal(codes[0].requestType, "PASSWORD_RESET");
      assert.equal(JSON.stringify(codes).includes("password="), false, "no password in the invitation");
      // The student now sees it as their own registration.
      const own = await (await regs()).getOwnRegistration({ uid: user.uid, email, name: null, role: "student" }, enrolSlug);
      assert.equal(own.id, registrationId);
    });

    test("duplicate webhook + checkout and repeated provisioning: one account, one link, one invitation", async () => {
      const email = `guest3-${run}@example.test`;
      const { registrationId } = await guestPay(email, enrolSlug, "webhook");
      const g = await guestLib();
      assert.equal(await g.provisionRegistrationAccount(registrationId), "not_applicable", "already linked");
      await g.provisionPendingRegistrations();
      assert.equal((await oobCodes(email)).length, 1);
    });

    test("an existing account for the email: no second account; linked only after that owner signs in with a verified email", async () => {
      const email = `guest4-${run}@example.test`;
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      const owner = await getAdminAuth().createUser({ email, password: `Pw-${randomUUID()}` });
      const { registrationId, paymentDocId } = await guestPay(email);
      let r = await registration(registrationId);
      assert.deepEqual([r.status, r.studentId, r.linkPending], ["paid", "", true]);
      assert.equal((await getAdminAuth().getUserByEmail(email)).uid, owner.uid, "no second account");
      // Teachers cannot place it yet.
      await clearDues(owner.uid);
      await assert.rejects((await regs()).assignRegistrationToBatch(teacher, registrationId, await newBatch("guest4")), /not linked yet/);
      const g = await guestLib();
      // Someone signed in with that address but WITHOUT verifying it cannot claim it.
      assert.equal(await g.claimGuestRegistrations({ uid: owner.uid, email, name: null, role: "student", emailVerified: false }), 0);
      assert.equal(await g.claimGuestRegistrations({ uid: "someone-else", email: `other-${run}@example.test`, name: null, role: "student", emailVerified: true }), 0);
      assert.equal(await g.claimGuestRegistrations({ uid: owner.uid, email, name: null, role: "student", emailVerified: true }), 1);
      r = await registration(registrationId);
      assert.deepEqual([r.studentId, r.linkPending], [owner.uid, false]);
      assert.equal((await db.collection("payments").doc(paymentDocId).get()).get("studentId"), owner.uid);
      // The owner can now be placed in a batch.
      await (await regs()).assignRegistrationToBatch(teacher, registrationId, await newBatch("guest4b"));
    });

    test("a paid guest registration cannot be changed or paid again; abandoned guest checkout stays recoverable", async () => {
      const email = `guest5-${run}@example.test`;
      const g = await guestLib();
      await guestPay(email);
      await assert.rejects(g.saveGuestRegistration({ slug: enrolSlug, mode: "batch", details: guestDetails(email) }, null, NOW), /already registered and paid/);
      const pending = await g.saveGuestRegistration({ slug: enrolSlug, mode: "batch", details: guestDetails(`guest6-${run}@example.test`) }, null, NOW);
      const gateway = await gw();
      const first = await gateway.createOrderForGuest(pending.registrationId, pending.token);
      // Checkout closed: nothing recorded, no account, and retrying reuses the order.
      assert.equal((await registration(pending.registrationId)).status, "pending_payment");
      assert.equal((await gateway.createOrderForGuest(pending.registrationId, pending.token)).orderId, first.orderId);
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      await assert.rejects(getAdminAuth().getUserByEmail(`guest6-${run}@example.test`), /no user record|not found/i);
    });
  });

  describe("enrolment types and Learn Together (two learners, one login)", () => {
    const pair = (a = "Anu Menon", b = "Balu Menon") => details({ learners: [{ fullName: a, age: "34" }, { fullName: b, dateOfBirth: "2016-05-20", guardianName: "Anu Menon", guardianRelationship: "Mother", guardianPhone: "+919847000000" }] });
    async function payFor(uid, registrationId) {
      const gateway = await gw();
      const order = await gateway.createOrderForStudent(student(uid), { kind: "registration", registrationId });
      const paymentId = `pay_LT${uid.replace(/[^A-Za-z0-9]/g, "")}${run.replace(/-/g, "")}`;
      razorpay.payments.set(paymentId, { id: paymentId, order_id: order.orderId, amount: order.amountMinor, currency: "INR", status: "captured" });
      const r = await gateway.confirmCheckoutPayment(student(uid), { orderId: order.orderId, paymentId, signature: sign(order.orderId, paymentId) });
      return { order, paymentId, status: r.status };
    }

    test("Batch – Individual ₹400 and One-to-One ₹750: one learner each", async () => {
      const { saveRegistration } = await regs();
      const b = await saveRegistration(student("lt-solo-b"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
      const i = await saveRegistration(student("lt-solo-i"), { slug: enrolSlug, mode: "individual", details: details() }, NOW);
      assert.deepEqual([b.initialAmountMinor, i.initialAmountMinor], [40_000, 75_000]);
      const rb = await registration(b.registrationId);
      assert.deepEqual([rb.enrolmentType, rb.learnerCount, rb.perLearnerRateMinor, rb.details.learners.length], ["batch", 1, 40_000, 1]);
    });

    test("Learn Together: ₹360 + ₹360 = ₹720 shared batch, ₹700 + ₹700 = ₹1,400 shared one-to-one; one login, both names", async () => {
      const { saveRegistration, listOwnRegistrations, listRegistrations } = await regs();
      const sb = await saveRegistration(student("lt-sb"), { slug: enrolSlug, mode: "shared_batch", details: pair() }, NOW);
      const si = await saveRegistration(student("lt-si"), { slug: enrolSlug, mode: "shared_individual", details: pair("Chitra K", "Devi K") }, NOW);
      assert.deepEqual([sb.initialAmountMinor, si.initialAmountMinor], [72_000, 140_000]);
      const r = await registration(sb.registrationId);
      assert.deepEqual([r.studentId, r.enrolmentType, r.mode, r.learnerCount, r.perLearnerRateMinor, r.rateMinor], ["lt-sb", "shared_batch", "batch", 2, 36_000, 72_000]);
      assert.deepEqual(r.details.learners.map((l) => l.fullName), ["Anu Menon", "Balu Menon"]);
      // Student dashboard (own registrations) and teacher list both carry both names.
      assert.deepEqual((await listOwnRegistrations(student("lt-sb")))[0].details.learners.map((l) => l.fullName), ["Anu Menon", "Balu Menon"]);
      const t = (await listRegistrations(teacher)).find((x) => x.id === sb.registrationId);
      assert.deepEqual(t.details.learners.map((l) => l.fullName), ["Anu Menon", "Balu Menon"]);
      // One login: no extra Firebase account was created for learner 2.
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      const users = (await getAdminAuth().listUsers(1000)).users.filter((u) => (u.displayName ?? "").includes("Balu Menon"));
      assert.equal(users.length, 0);
    });

    test("Learn Together with one learner, or more than two, is rejected; the price never comes from the browser", async () => {
      const { saveRegistration } = await regs();
      const one = await saveRegistration(student("lt-bad"), { slug: enrolSlug, mode: "shared_batch", details: details({ learners: [{ fullName: "Only One", age: "30" }] }) }, NOW).catch((e) => e);
      assert.match(one.fieldErrors.learners, /exactly 2/);
      const three = await saveRegistration(
        student("lt-bad"),
        { slug: enrolSlug, mode: "shared_batch", details: details({ learners: [{ fullName: "A One", age: "30" }, { fullName: "B Two", age: "30" }, { fullName: "C Three", age: "30" }] }) },
        NOW,
      ).catch((e) => e);
      assert.match(three.fieldErrors.learners, /exactly 2/);
      await assert.rejects(saveRegistration(student("lt-bad"), { slug: enrolSlug, mode: "family_special", details: pair() }, NOW), /highlighted/);
      const tampered = await saveRegistration(student("lt-tamper"), { slug: enrolSlug, mode: "shared_batch", details: { ...pair(), rateMinor: 1, initialAmountMinor: 1, perLearnerRateMinor: 1 } }, NOW);
      assert.equal(tampered.initialAmountMinor, 72_000);
      assert.equal((await registration(tampered.registrationId)).rateMinor, 72_000);
      assert.equal((await db.collection("registrations").where("studentId", "==", "lt-bad").get()).size, 0);
    });

    test("shared batch: verified ₹720 payment, no duplicate checkout, two places in the batch, one invoice for both at ₹720 per session", async () => {
      const { saveRegistration, assignRegistrationToBatch } = await regs();
      const { registrationId } = await saveRegistration(student("lt-pay"), { slug: enrolSlug, mode: "shared_batch", details: pair("Esha R", "Farah R") }, NOW);
      const { order, status } = await payFor("lt-pay", registrationId);
      assert.deepEqual([order.amountMinor, status], [72_000, "recorded"]);
      // Paid: no second checkout, no second registration.
      await assert.rejects((await gw()).createOrderForStudent(student("lt-pay"), { kind: "registration", registrationId }), /Nothing is payable/);
      await assert.rejects(saveRegistration(student("lt-pay"), { slug: enrolSlug, mode: "shared_batch", details: pair("Esha R", "Farah R") }, NOW), /already registered and paid/);
      // Capacity: a batch with one free place cannot take two learners.
      await clearDues("lt-pay");
      const tight = await newBatch("lt-tight", { capacity: 5 });
      await db.collection("batches").doc(tight).update({ memberCount: 4 });
      await assert.rejects(assignRegistrationToBatch(teacher, registrationId, tight), /needs 2/);
      const batchId = await newBatch("lt-batch");
      const { accountId } = await assignRegistrationToBatch(teacher, registrationId, batchId);
      assert.equal((await db.collection("batches").doc(batchId).get()).get("memberCount"), 2);
      const a = await account(accountId);
      assert.deepEqual([a.learnerCount, a.learnerNames, a.perLearnerRateMinor, a.agreedRates[0].rateMinor, a.advance.amountMinor], [2, ["Esha R", "Farah R"], 36_000, 72_000, 72_000]);
      // November: attended, absent (billable), academy-cancelled (not billable), attended → 3 sessions × ₹720 − ₹720 initial payment.
      const outcomes = ["attended", "absent", "academy_cancelled", "attended"];
      for (let n = 1; n <= 4; n++) await charge(await weekly("lt-pay", accountId, n), outcomes[n - 1]);
      await issue(accountId, new Date(NOV_CLOSE).toISOString());
      const inv = await monthInvoice(accountId, "2026-11");
      assert.deepEqual([inv.lines.length, inv.subtotalMinor, inv.advanceAppliedMinor, inv.amountDueMinor], [3, 216_000, 72_000, 144_000]);
      assert.deepEqual([inv.learnerNames, inv.perLearnerRateMinor, inv.learnerCount], [["Esha R", "Farah R"], 36_000, 2]);
      assert.equal((await db.collection("invoices").where("accountId", "==", accountId).get()).size, 1, "one invoice for the shared enrolment");
      // Removing the shared enrolment frees both places.
      await removeMemberTx(teacher, batchId, "lt-pay", "Left");
      assert.equal((await db.collection("batches").doc(batchId).get()).get("memberCount"), 0);
    });

    test("shared one-to-one: schedule confirmed, sessions billed at ₹1,400 with the 24-hour rule", async () => {
      const { saveRegistration, confirmIndividualSchedule } = await regs();
      const { registrationId } = await saveRegistration(student("lt-121"), { slug: enrolSlug, mode: "shared_individual", details: pair("Gita S", "Hari S") }, NOW);
      await payFor("lt-121", registrationId);
      await clearDues("lt-121");
      const { accountId } = await confirmIndividualSchedule(teacher, registrationId, { days: ["sun"], start: "10:00", end: "11:00", note: "" });
      const a = await account(accountId);
      assert.deepEqual([a.learnerCount, a.learnerNames, a.agreedRates[0].rateMinor], [2, ["Gita S", "Hari S"], 140_000]);
      const session = async (n) => {
        const ref = db.collection("liveClasses").doc(id(`lt121-${n}`));
        const start = Date.parse(weekIso(n));
        await ref.set({ studentId: "lt-121", title: `S${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "10:00", endTime: "11:00", meetUrl: null, status: "scheduled", packageId: null, batchId: null, billingAccountId: accountId });
        return mapLiveClass(await ref.get());
      };
      const s1 = await session(1);
      const s2 = await session(2);
      const s3 = await session(3);
      assert.equal(await charge(s1, "attended"), "charge");
      assert.equal(await charge(s2, "student_cancelled", new Date(Date.parse(s2.startAt) - 2 * 3_600_000).toISOString()), "charge"); // < 24 h
      assert.equal(await charge(s3, "student_cancelled", new Date(Date.parse(s3.startAt) - 48 * 3_600_000).toISOString()), "charge"); // any notice
      await issue(accountId, new Date(NOV_CLOSE).toISOString());
      const inv = await monthInvoice(accountId, "2026-11");
      assert.deepEqual([inv.lines.length, inv.subtotalMinor, inv.advanceAppliedMinor, inv.amountDueMinor, inv.perLearnerRateMinor], [3, 420_000, 140_000, 280_000, 70_000]);
    });

    test("registrations and accounts saved before enrolment types still read as single-learner enrolments", async () => {
      const ref = db.collection("registrations").doc(id("legacy-reg"));
      await ref.set({ studentId: "lt-old", courseSlug: enrolSlug, courseId: enrolCourse, courseTitle: "Enrol Course", mode: "individual", status: "paid", rateMinor: 75_000, initialAmountMinor: 75_000, details: { fullName: "Old Learner", age: 40 } });
      const r = await registration(ref.id);
      assert.deepEqual([r.enrolmentType, r.learnerCount, r.perLearnerRateMinor, r.details.learners.map((l) => l.fullName)], ["individual", 1, 75_000, ["Old Learner"]]);
      const acc = db.collection("billingAccounts").doc(id("legacy-acc"));
      await acc.set({ studentId: "lt-old", courseId: enrolCourse, mode: "batch", status: "active", studentName: "Old Learner", agreedRates: [{ effectiveFrom: "2026-11", rateMinor: 40_000 }] });
      const a = await account(acc.id);
      assert.deepEqual([a.learnerCount, a.learnerNames, a.perLearnerRateMinor, a.agreedRates[0].rateMinor], [1, ["Old Learner"], null, 40_000]);
    });
  });

  describe("Special Programmes (full fee, one payment, no monthly billing)", () => {
    const progCourse = id("prog-course");
    const progSlug = `prog-course-${run}`;
    const fullCourse = id("prog-full");
    const fullSlug = `prog-full-${run}`;
    const programme = (o = {}) => ({
      programmeType: "bhajan", feeMinor: 250_000, durationText: "4 weeks", startDate: "2026-12-05", endDate: "2026-12-26",
      sessions: [
        { id: "2026-12-05_1800", date: "2026-12-05", start: "18:00", end: "19:00", title: "Introduction", recordingVideoId: null },
        { id: "2026-12-12_1800", date: "2026-12-12", start: "18:00", end: "19:00", title: "Second bhajan", recordingVideoId: null },
      ],
      maxParticipants: null, materials: "Lyrics sheet", recordingsAvailable: true, status: "open", ...o,
    });
    const progDetails = () => details({ preferredDays: [], preferredTimes: [] });
    before(async () => {
      await db.collection("courses").doc(progCourse).set({ id: progCourse, slug: progSlug, title: "Bhajan Programme", description: "", status: "published", availability: "open", teacherIds: [teacher.uid], programme: programme() });
      await db.collection("courses").doc(fullCourse).set({ id: fullCourse, slug: fullSlug, title: "Full Workshop", description: "", status: "published", availability: "open", teacherIds: [teacher.uid], programme: programme({ maxParticipants: 1 }) });
    });
    async function payProgramme(uid, slug = progSlug) {
      const { registrationId, initialAmountMinor } = await (await regs()).saveRegistration(student(uid), { slug, mode: "individual", details: progDetails() }, NOW);
      const gateway = await gw();
      const order = await gateway.createOrderForStudent(student(uid), { kind: "registration", registrationId });
      const paymentId = `pay_P${uid.replace(/[^A-Za-z0-9]/g, "")}${run.replace(/-/g, "")}`;
      razorpay.payments.set(paymentId, { id: paymentId, order_id: order.orderId, amount: order.amountMinor, currency: "INR", status: "captured" });
      return { registrationId, initialAmountMinor, order, paymentId, gateway };
    }

    test("special full payment: the server prices the full fee (mode ignored); verified once → confirmed + course access; regular registrations are unchanged", async () => {
      const { registrationId, initialAmountMinor, order, paymentId, gateway } = await payProgramme("pg-1");
      assert.deepEqual([initialAmountMinor, order.amountMinor], [250_000, 250_000], "full programme fee, never a first-class amount");
      const { getStudentCourseAccess } = await import("@/lib/lms/server/access");
      assert.equal(await getStudentCourseAccess(student("pg-1"), progCourse), null, "no access before the verified payment");
      assert.equal((await gateway.confirmCheckoutPayment(student("pg-1"), { orderId: order.orderId, paymentId, signature: sign(order.orderId, paymentId) })).status, "recorded");
      const r = await registration(registrationId);
      assert.deepEqual([r.kind, r.status, r.initialAmountMinor], ["special", "paid", 250_000]);
      const { registrationStatusLabel } = await import("@/lib/lms/registration");
      assert.equal(registrationStatusLabel(r.status, r.mode, r.kind), "Paid — Registration confirmed");
      assert.ok(await getStudentCourseAccess(student("pg-1"), progCourse), "access granted by the verified full payment");
      const pay = (await db.collection("payments").doc(`rzp_${paymentId}`).get()).data();
      assert.deepEqual([pay.amountMinor, pay.verified, pay.accountId], [250_000, true, null]);
      // A regular course still prices the first class (unchanged).
      assert.equal((await (await regs()).saveRegistration(student("pg-1"), { slug: enrolSlug, mode: "batch", details: details() }, NOW)).initialAmountMinor, 40_000);
    });

    test("special: no billing account, no first-class advance, no monthly invoice — even after the month closes and the scheduled job runs", async () => {
      const p = await payProgramme("pg-2");
      await p.gateway.confirmCheckoutPayment(student("pg-2"), { orderId: p.order.orderId, paymentId: p.paymentId, signature: sign(p.order.orderId, p.paymentId) });
      assert.equal((await registration(p.registrationId)).status, "paid");
      await billing.runScheduledBilling(teacher, new Date(NOV_CLOSE + 3_600_000).toISOString());
      for (const c of ["billingAccounts", "invoices", "advanceLedger", "billableClasses"]) {
        assert.equal((await db.collection(c).where("studentId", "==", "pg-2").get()).size, 0, c);
      }
    });

    test("duplicate payment prevented; invalid signature rejected; a programme is never placed in a batch or scheduled", async () => {
      const { registrationId, order, paymentId, gateway } = await payProgramme("pg-3");
      await assert.rejects(gateway.confirmCheckoutPayment(student("pg-3"), { orderId: order.orderId, paymentId, signature: "0".repeat(64) }), /could not be verified/);
      assert.equal((await registration(registrationId)).status, "pending_payment", "a forged signature records nothing");
      await gateway.confirmCheckoutPayment(student("pg-3"), { orderId: order.orderId, paymentId, signature: sign(order.orderId, paymentId) });
      await processVerifiedGatewayPayment({ orderId: order.orderId, paymentId, amountMinor: 250_000, currency: "INR", status: "captured", via: "webhook" });
      assert.equal((await db.collection("payments").where("registrationId", "==", registrationId).get()).size, 1, "checkout + webhook: one payment");
      await assert.rejects(gateway.createOrderForStudent(student("pg-3"), { kind: "registration", registrationId }), /Nothing is payable/);
      await assert.rejects((await regs()).saveRegistration(student("pg-3"), { slug: progSlug, mode: "batch", details: progDetails() }, NOW), /already registered and paid/);
      const batchId = await newBatch("pg-batch", { courseId: progCourse });
      await clearDues("pg-3");
      await assert.rejects(addMemberTx(teacher, batchId, { uid: "pg-3", name: "pg-3" }, { registrationId }), /Special Programme/);
      await assert.rejects((await regs()).confirmIndividualSchedule(teacher, registrationId, { days: ["sat"], start: "19:00", end: "20:00", note: "" }), /Special Programme/);
    });

    test("participant limit: once the confirmed registrations reach it, new registrations are refused", async () => {
      const first = await payProgramme("pg-4", fullSlug);
      await first.gateway.confirmCheckoutPayment(student("pg-4"), { orderId: first.order.orderId, paymentId: first.paymentId, signature: sign(first.order.orderId, first.paymentId) });
      await assert.rejects((await regs()).saveRegistration(student("pg-5"), { slug: fullSlug, mode: "batch", details: progDetails() }, NOW), /is full/);
    });

    test("session recordings: only registered participants (active enrolment) see them; invalid URLs are rejected", async () => {
      const rec = await import("@/lib/lms/server/recordings");
      await assert.rejects(rec.saveProgrammeSessionRecording(progCourse, "2026-12-05_1800", "https://vimeo.com/123"), /highlighted/);
      await rec.saveProgrammeSessionRecording(progCourse, "2026-12-05_1800", "https://youtu.be/dQw4w9WgXcQ");
      await assert.rejects(rec.saveProgrammeSessionRecording(progCourse, "2027-01-01_1800", "https://youtu.be/dQw4w9WgXcQ"), /could not be found/);
      const own = await rec.listOwnProgrammeRecordings(student("pg-1"), progCourse);
      assert.deepEqual(own.map((s) => s.videoId), ["dQw4w9WgXcQ", null]);
      assert.equal(await rec.listOwnProgrammeRecordings(student("pg-not-registered"), progCourse), null);
      assert.equal(await rec.listOwnProgrammeRecordings(student("pg-3-pending"), progCourse), null);
      // The public catalogue never carries the recording.
      const { getPublishedCourseBySlug } = await import("@/lib/catalog/server");
      const pub = await getPublishedCourseBySlug(progSlug);
      assert.equal(JSON.stringify(pub).includes("dQw4w9WgXcQ"), false);
    });
  });

  describe("class recordings (YouTube)", () => {
    const VID = "dQw4w9WgXcQ";
    const rec = () => import("@/lib/lms/server/recordings");
    const recCourse = course; // the batch-billing course used above
    async function heldClass(uid, n, { accountId, batchId = id(`rb-${uid}`), sessionKey = id(`rs-${uid}-${n}`), status = "completed", cancelKind = null } = {}) {
      const ref = db.collection("liveClasses").doc(id(`rec-${uid}-${n}`));
      const start = Date.parse("2026-11-03T13:30:00.000Z") + n * 86_400_000;
      await ref.set({
        studentId: uid, title: `Topic ${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), timeZone: "Asia/Kolkata",
        date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij",
        status, cancelKind, attendance: status === "completed" ? "attended" : null, packageId: null, batchId, sessionKey, billingAccountId: accountId ?? null,
      });
      return ref.id;
    }
    async function batchLearner(uid, extra = {}) {
      const batchRef = db.collection("batches").doc(id(`rb-${uid}`));
      await batchRef.set({ name: uid, courseId: recCourse, courseTitle: "Swara Foundation", teacherId: teacher.uid, status: "active", capacity: 5, memberCount: 1 });
      await enroll(uid);
      const accountId = id(`ra-${uid}`);
      await db.collection("billingAccounts").doc(accountId).set({ studentId: uid, courseId: recCourse, mode: "batch", status: "active", ...extra });
      return { accountId, batchId: batchRef.id };
    }

    test("teacher adds, edits and removes a recording; every learner record of the batch session gets it; a scheduled class is refused", async () => {
      const r = await rec();
      const a = await batchLearner("rc-1");
      const b = await batchLearner("rc-2");
      const key = id("rc-session");
      const c1 = await heldClass("rc-1", 1, { ...a, batchId: id("rc-shared-batch"), sessionKey: key });
      const c2 = await heldClass("rc-2", 1, { ...b, batchId: id("rc-shared-batch"), sessionKey: key, status: "cancelled", cancelKind: "student" });
      const added = await r.saveClassRecording(teacher, c1, `https://www.youtube.com/watch?v=${VID}`);
      assert.deepEqual([added.change, added.records], ["Recording added", 2]);
      for (const cid of [c1, c2]) assert.equal((await db.collection("liveClasses").doc(cid).get()).get("recordingVideoId"), VID);
      assert.equal((await r.saveClassRecording(teacher, c1, "https://youtu.be/abcdefghijk")).change, "Recording changed");
      assert.equal((await db.collection("liveClasses").doc(c2).get()).get("recordingVideoId"), "abcdefghijk");
      assert.equal((await r.saveClassRecording(teacher, c1, "")).change, "Recording removed");
      assert.equal((await db.collection("liveClasses").doc(c1).get()).get("recordingVideoId"), null);
      const upcoming = await heldClass("rc-1", 9, { ...a, status: "scheduled" });
      await assert.rejects(r.saveClassRecording(teacher, upcoming, `https://youtu.be/${VID}`), /once the class has been held/);
    });

    test("invalid URL rejected; only teachers can set recordings", async () => {
      const r = await rec();
      const a = await batchLearner("rc-3");
      const c = await heldClass("rc-3", 1, a);
      for (const bad of ["https://vimeo.com/1", `https://youtube.com.evil.example/watch?v=${VID}`, "not a url"]) {
        await assert.rejects(r.saveClassRecording(teacher, c, bad), /highlighted/);
      }
      await assert.rejects(r.saveClassRecording(student("rc-3"), c, `https://youtu.be/${VID}`), /Teacher role/);
      assert.equal((await db.collection("liveClasses").doc(c).get()).get("recordingVideoId"), undefined, "nothing stored");
    });

    test("enrolled student sees their class recordings in order; another or unenrolled student is blocked; no active enrolment is blocked", async () => {
      const r = await rec();
      const a = await batchLearner("rc-4");
      const c2 = await heldClass("rc-4", 2, a);
      const c1 = await heldClass("rc-4", 1, a);
      await r.saveClassRecording(teacher, c1, `https://youtu.be/${VID}`);
      const list = await r.listOwnCourseRecordings(student("rc-4"), recCourse);
      assert.deepEqual(list.map((x) => [x.number, x.classId, x.videoId]), [[1, c1, VID], [2, c2, null]]);
      assert.equal(await r.listOwnCourseRecordings(student("rc-intruder"), recCourse), null, "not enrolled");
      await enroll("rc-other");
      assert.deepEqual(await r.listOwnCourseRecordings(student("rc-other"), recCourse), [], "enrolled, but not in that class");
      await db.collection("enrollments").doc(`${recCourse}_rc-4`).update({ status: "revoked" });
      assert.equal(await r.listOwnCourseRecordings(student("rc-4"), recCourse), null, "no active enrolment");
    });

    test("Learn Together: both learners use the one login, so they see the same recording", async () => {
      const r = await rec();
      const a = await batchLearner("rc-lt", { learnerCount: 2, learnerNames: ["Anu", "Balu"] });
      const c = await heldClass("rc-lt", 1, a);
      await r.saveClassRecording(teacher, c, `https://youtu.be/${VID}`);
      assert.equal((await r.listOwnCourseRecordings(student("rc-lt"), recCourse))[0].videoId, VID);
    });

    test("historical invoices are unchanged by recordings", async () => {
      const r = await rec();
      const snap = await db.collection("invoices").limit(5).get();
      const before = snap.docs.map((d) => JSON.stringify(d.data()));
      const cls = await db.collection("liveClasses").where("status", "==", "completed").limit(3).get();
      for (const d of cls.docs) await r.saveClassRecording(teacher, d.id, `https://youtu.be/${VID}`).catch(() => null);
      const after = await Promise.all(snap.docs.map(async (d) => JSON.stringify((await d.ref.get()).data())));
      assert.ok(before.length > 0, "invoices exist from the billing tests");
      assert.deepEqual(after, before);
    });
  });

  test("privacy: students see only their own registration; the list and details are teacher-only; no browser access", async () => {
    const { saveRegistration, getOwnRegistration, listOwnRegistrations, listRegistrations, getRegistrationDetail } = await regs();
    const { registrationId } = await saveRegistration(student("rg-p1"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
    assert.equal(await getOwnRegistration(student("rg-p2"), enrolSlug), null);
    assert.equal((await listOwnRegistrations(student("rg-p2"))).length, 0);
    await assert.rejects(listRegistrations(student("rg-p1")), /Only the academy/);
    await assert.rejects(getRegistrationDetail(student("rg-p1"), registrationId), /Only the academy/);
    assert.ok((await listRegistrations(teacher)).some((r) => r.id === registrationId));
    const detail = await getRegistrationDetail(teacher, registrationId);
    assert.equal(detail.registration.details.address, "12 Temple Road, Thrissur");
    assert.equal(detail.courseInDashboard, true);
  });

  test("Test Mode isolation: registration payments are refused on a project that is not allow-listed", async () => {
    const { saveRegistration } = await regs();
    const gateway = await gw();
    const { registrationId } = await saveRegistration(student("rg-p3"), { slug: enrolSlug, mode: "batch", details: details() }, NOW);
    const order = await gateway.createOrderForStudent(student("rg-p3"), { kind: "registration", registrationId });
    const project = process.env.FIREBASE_ADMIN_PROJECT_ID;
    process.env.FIREBASE_ADMIN_PROJECT_ID = "swaranjanam-prod";
    try {
      const { GatewayConfigError } = await import("@/lib/payments/razorpay");
      await assert.rejects(processVerifiedGatewayPayment({ orderId: order.orderId, paymentId: "pay_P3", amountMinor: 40_000, currency: "INR", status: "captured", via: "webhook" }), GatewayConfigError);
    } finally {
      process.env.FIREBASE_ADMIN_PROJECT_ID = project;
    }
    assert.equal((await registration(registrationId)).status, "pending_payment");
  });
});
