// END-TO-END audit of student notifications + Resend email delivery (Firestore + Auth EMULATORS).
//
// Every event is produced by the REAL business path: signed Razorpay webhooks through the route
// handler, teacher Server Actions with a real (emulator) session cookie, and the scheduled billing
// job. Resend is the real SDK with its HTTP API mocked (api.resend.com only): no real email, no real
// payment, no production project. Run with: npm run test:emulator
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

const PROJECT = "demo-swaranjanam";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!HOST || !AUTH_HOST) throw new Error("Run with `npm run test:emulator` (Firestore + Auth emulators).");

const WEBHOOK_SECRET = `whsec_${randomUUID()}`;
const RESEND_KEY = `re_test_${randomUUID().replace(/-/g, "")}`;
Object.assign(process.env, {
  FIREBASE_ADMIN_PROJECT_ID: PROJECT,
  FIREBASE_ADMIN_CLIENT_EMAIL: "emulator@demo-swaranjanam.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }),
  NEXT_PUBLIC_SITE_URL: "https://academy.example.test",
  // Fake TEST credentials, generated here. Razorpay is never called; Resend's API is mocked below.
  RAZORPAY_KEY_ID: "rzp_test_FakeKey123",
  RAZORPAY_KEY_SECRET: `fake_${randomUUID()}`,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  RAZORPAY_TEST_FIREBASE_PROJECTS: "",
  RESEND_API_KEY: RESEND_KEY,
  EMAIL_FROM: "Swaraanjanam <notifications@example.test>",
  // Use the real Resend transport against the mocked API (the emulator default only logs).
  EMAIL_SEND_IN_EMULATOR: "true",
});

// ---- Mocked Resend API ------------------------------------------------------------------------------
const realFetch = globalThis.fetch;
const resend = { calls: [], mode: "ok", byKey: new Map() };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.razorpay.com/")) throw new Error("Razorpay must never be called in this test");
  if (!u.startsWith("https://api.resend.com/")) return realFetch(url, init);
  const headers = new Headers(init.headers);
  const body = JSON.parse(String(init.body));
  const key = headers.get("idempotency-key");
  resend.calls.push({ url: u, auth: headers.get("authorization"), key, body });
  if (resend.mode === "fail") return new Response(JSON.stringify({ name: "internal_server_error", message: "Resend unavailable", statusCode: 500 }), { status: 500, headers: { "content-type": "application/json" } });
  // Like Resend: the same idempotency key returns the original email, never a second one.
  if (!resend.byKey.has(key)) resend.byKey.set(key, { id: `email_${resend.byKey.size + 1}`, body });
  return new Response(JSON.stringify({ id: resend.byKey.get(key).id }), { status: 200, headers: { "content-type": "application/json" } });
};
/** Emails actually delivered (unique idempotency keys) to an address. */
const deliveredTo = (email) => [...resend.byKey.values()].filter((e) => e.body.to.includes(email)).map((e) => e.body);

const { getAdminDb, getAdminAuth } = await import("@/lib/firebase/admin");
const { POST: webhook } = await import("@/app/api/payments/razorpay/webhook/route");
const teacherRegistration = await import("@/app/(account)/teacher/registration-actions");
const classActions = await import("@/app/(account)/teacher/class-actions");
const paymentActions = await import("@/app/(account)/teacher/payment-actions");
const studentActions = await import("@/app/(account)/dashboard/notification-actions");
const billing = await import("@/lib/lms/server/class-billing");
const svc = await import("@/lib/notifications/service");
const ev = await import("@/lib/notifications/events");
const { SESSION_COOKIE_NAME } = await import("@/lib/auth/constants");
const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

const db = getAdminDb();
const auth = getAdminAuth();
const run = randomUUID().slice(0, 6).replace(/-/g, "");
const clearAll = () => realFetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
const settle = () => svc.settleEmailDeliveries();

// ---- Accounts and sessions (Auth emulator) --------------------------------------------------------
const PASSWORD = `Pw-${randomUUID()}`;
async function account(label, role) {
  const email = `${label}-${run}@example.test`;
  const user = await auth.createUser({ email, password: PASSWORD, displayName: label, emailVerified: true });
  if (role === "teacher") await auth.setCustomUserClaims(user.uid, { role: "teacher" });
  await db.collection("users").doc(user.uid).set({ email, displayName: label, role });
  const res = await realFetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const { idToken } = await res.json();
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: 60 * 60 * 1000 });
  return { uid: user.uid, email, cookie };
}
const actAs = (who) => {
  globalThis.__testCookies = who ? { [SESSION_COOKIE_NAME]: who.cookie } : {};
};
const ok = (result) => {
  assert.equal(result.ok, true, result.ok ? "" : `action failed: ${result.error} ${JSON.stringify(result.fieldErrors ?? {})}`);
  return result.data;
};
const notificationsOf = async (uid, type) => (await db.collection("notifications").where("userId", "==", uid).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((n) => !type || n.type === type);
const outboxOf = async (uid) => (await db.collection("emailOutbox").where("userId", "==", uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

// ---- Signed Razorpay webhooks through the real route ----------------------------------------------
async function postWebhook(eventId, event, entity) {
  const body = JSON.stringify({ event, payload: { payment: { entity } } });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  const res = await webhook(new Request("http://localhost/api/payments/razorpay/webhook", { method: "POST", body, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } }));
  return { status: res.status, json: await res.json() };
}

// ---- Fixtures ---------------------------------------------------------------------------------------
const COURSE = `course-${run}`;
const SLUG = `swara-${run}`;
let teacher, asha, ravi, outsider;
const results = {};
const record = (event, checks) => {
  results[event] = checks;
};

async function pendingRegistration(student, mode, amountMinor) {
  const rid = `${student.uid}_${SLUG}_${mode}`;
  await db.collection("registrations").doc(rid).set({
    studentId: student.uid, studentEmail: student.email, courseSlug: SLUG, courseId: COURSE, courseTitle: "Swara Foundation", mode, enrolmentType: mode,
    kind: "regular", status: "pending_payment", initialAmountMinor: amountMinor, rateMinor: amountMinor, perLearnerRateMinor: amountMinor, learnerCount: 1,
    paymentId: null, batchId: null, accountId: null, confirmedSchedule: null,
    details: { fullName: `${student === asha ? "Asha" : "Ravi"} Menon`, email: student.email, mobile: "9999999999", learners: [{ fullName: `${student === asha ? "Asha" : "Ravi"} Menon` }] },
    createdAt: FieldValue.serverTimestamp(), history: [],
  });
  const orderId = `order_${rid.replace(/[^A-Za-z0-9]/g, "").slice(0, 30)}`;
  await db.collection("gatewayOrders").doc(orderId).set({ target: { kind: "registration", registrationId: rid }, mode: "test", studentId: student.uid, amountMinor, currency: "INR", status: "created", description: "Swara Foundation registration" });
  return { rid, orderId };
}
const captured = (orderId, paymentId, amountMinor) => ({ id: paymentId, order_id: orderId, amount: amountMinor, currency: "INR", status: "captured" });

before(async () => {
  await clearAll();
  await realFetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  [teacher, asha, ravi, outsider] = await Promise.all([account("teacher", "teacher"), account("asha", "student"), account("ravi", "student"), account("outsider", "student")]);
  await db.collection("courses").doc(COURSE).set({ title: "Swara Foundation", slug: SLUG, status: "published", teacherIds: [teacher.uid] });
  for (const s of [asha, ravi]) {
    await db.collection("legacyDues").doc(s.uid).set({ studentId: s.uid, status: "no_previous_dues", note: "test", verifiedBy: teacher.uid, verifiedAt: FieldValue.serverTimestamp() });
  }
  await db.collection("batches").doc(`batch-${run}`).set({
    name: "Evening Beginners", courseId: COURSE, courseTitle: "Swara Foundation", teacherId: teacher.uid, teacherName: "Smt. Anjana",
    schedule: "Tuesday & Saturday, 19:00–20:00 IST", days: ["tue", "sat"], startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", capacity: 5, memberCount: 0, status: "active",
  });
});
after(async () => {
  globalThis.fetch = realFetch;
  delete globalThis.__testCookies;
  await clearAll();
  // Printed for the audit report.
  console.log("\nAUDIT RESULTS\n" + JSON.stringify(results, null, 2));
});
beforeEach(() => {
  resend.mode = "ok";
});

describe("notification audit (real business paths)", () => {
  let ashaPaymentDocId;

  test("1 + 2. registration completed and payment verified — signed webhook; redeliveries and a second event id do not duplicate", async () => {
    const { rid, orderId } = await pendingRegistration(asha, "batch", 40_000);
    const paymentId = `pay_A${run}`;
    const first = await postWebhook(`evt_A1${run}`, "payment.captured", captured(orderId, paymentId, 40_000));
    assert.equal(first.status, 200);
    assert.equal(first.json.outcome, "recorded");
    assert.equal((await postWebhook(`evt_A1${run}`, "payment.captured", captured(orderId, paymentId, 40_000))).json.duplicate, true); // same event redelivered
    assert.equal((await postWebhook(`evt_A2${run}`, "order.paid", captured(orderId, paymentId, 40_000))).json.outcome, "duplicate"); // different event, same payment
    await settle();
    ashaPaymentDocId = `rzp_${paymentId}`;

    assert.equal((await db.collection("registrations").doc(rid).get()).get("status"), "paid");
    const paid = await notificationsOf(asha.uid, "payment_success");
    const done = await notificationsOf(asha.uid, "registration_completed");
    assert.equal(paid.length, 1);
    assert.equal(done.length, 1);
    assert.equal(paid[0].title, "Payment successful");
    assert.match(paid[0].message, /₹400 received for registration \(initial payment\) — Swara Foundation/);
    assert.equal(paid[0].link, `/receipts/${ashaPaymentDocId}`);
    assert.ok((await db.collection("receipts").doc(ashaPaymentDocId).get()).exists, "receipt page target exists");
    assert.equal(done[0].title, "Registration complete");
    assert.equal(done[0].link, "/dashboard");
    const mails = deliveredTo(asha.email);
    assert.equal(mails.filter((m) => m.subject === "Payment Successful — Swaraanjanam").length, 1);
    const reg = mails.filter((m) => m.subject === "Your Swaraanjanam Registration is Complete");
    assert.equal(reg.length, 1);
    for (const s of ["Asha Menon", "Swara Foundation", "Paid — Awaiting Batch Assignment", "Paid (verified)", "Next steps"]) assert.ok(reg[0].text.includes(s), s);
    assert.ok(reg[0].html.includes("https://academy.example.test/dashboard"));
    assert.equal(reg[0].from, "Swaraanjanam <notifications@example.test>");
    assert.equal((await notificationsOf(outsider.uid)).length, 0);
    record("1. Registration completed", "PASS");
    record("2. Razorpay payment verified", "PASS");
  });

  test("2b. a not-captured payment (browser 'success' only) never notifies", async () => {
    const { orderId } = await pendingRegistration(ravi, "individual", 75_000);
    const r = await postWebhook(`evt_R0${run}`, "payment.captured", { ...captured(orderId, `pay_R0${run}`, 75_000), status: "authorized" });
    assert.equal(r.json.outcome, "not_captured");
    assert.equal((await notificationsOf(ravi.uid)).length, 0);
  });

  test("3. payment failure — signed payment.failed webhook; redelivery does not duplicate", async () => {
    // Ravi's registration order from 2b (still unpaid).
    const realOrder = (await db.collection("gatewayOrders").where("studentId", "==", ravi.uid).get()).docs[0].id;
    const entity = { id: `pay_RF${run}`, order_id: realOrder, amount: 75_000, currency: "INR", status: "failed", error_code: "BAD_REQUEST_ERROR", error_description: "Payment declined by bank" };
    await postWebhook(`evt_RF1${run}`, "payment.failed", entity);
    await postWebhook(`evt_RF1${run}`, "payment.failed", entity);
    await postWebhook(`evt_RF2${run}`, "payment.failed", entity);
    await settle();
    const failed = await notificationsOf(ravi.uid, "payment_failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].title, "Payment failed");
    assert.match(failed[0].message, /₹750 for Swara Foundation registration did not go through/);
    assert.equal(failed[0].link, "/dashboard/billing");
    const mails = deliveredTo(ravi.email).filter((m) => m.subject === "Payment Failed — Swaraanjanam");
    assert.equal(mails.length, 1);
    assert.ok(mails[0].text.includes("Reason: Payment declined by bank"));
    record("3. Payment failure", "PASS");
  });

  test("4. batch assignment — teacher Server Action; repeat refused; only that student notified", async () => {
    actAs(teacher);
    const rid = `${asha.uid}_${SLUG}_batch`;
    ok(await teacherRegistration.assignToBatch(rid, `batch-${run}`));
    const again = await teacherRegistration.assignToBatch(rid, `batch-${run}`);
    assert.equal(again.ok, false);
    await settle();
    const n = await notificationsOf(asha.uid, "batch_assigned");
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "You have been assigned to a batch");
    assert.equal(n[0].message, "You are in Evening Beginners for Swara Foundation. Schedule: Tuesday & Saturday, 19:00–20:00 IST.");
    assert.equal(n[0].link, "/dashboard");
    const mail = deliveredTo(asha.email).filter((m) => m.subject === "Your Swaraanjanam Class Schedule is Confirmed");
    assert.equal(mail.length, 1);
    for (const s of ["Swara Foundation", "Evening Beginners", "Smt. Anjana", "Tuesday & Saturday, 19:00–20:00 IST"]) assert.ok(mail[0].text.includes(s), s);
    assert.equal((await notificationsOf(ravi.uid, "batch_assigned")).length, 0);
    assert.equal((await notificationsOf(outsider.uid)).length, 0);
    record("4. Batch assignment", "PASS");
  });

  test("5. individual scheduling — confirm then change via teacher Server Actions; identical re-save does not notify", async () => {
    // Ravi pays (webhook), then the teacher confirms his one-to-one schedule.
    const order = (await db.collection("gatewayOrders").where("studentId", "==", ravi.uid).get()).docs[0];
    await postWebhook(`evt_R1${run}`, "payment.captured", captured(order.id, `pay_R1${run}`, 75_000));
    const rid = `${ravi.uid}_${SLUG}_individual`;
    actAs(teacher);
    ok(await teacherRegistration.confirmSchedule(rid, { days: ["mon"], start: "18:00", end: "19:00", note: "" }));
    assert.equal((await teacherRegistration.confirmSchedule(rid, { days: ["mon"], start: "18:00", end: "19:00", note: "" })).ok, false);
    await settle();
    const confirmed = await notificationsOf(ravi.uid, "individual_scheduled");
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].title, "Your class schedule is confirmed");
    assert.match(confirmed[0].message, /Your individual Swara Foundation classes are confirmed: Monday, 18:00–19:00 IST\./);
    assert.equal(deliveredTo(ravi.email).filter((m) => m.subject === "Your Swaraanjanam Class Schedule is Confirmed").length, 1);

    ok(await teacherRegistration.changeSchedule(rid, { days: ["wed"], start: "18:00", end: "19:00", note: "" }));
    ok(await teacherRegistration.changeSchedule(rid, { days: ["wed"], start: "18:00", end: "19:00", note: "" })); // nothing changed
    await settle();
    const changed = await notificationsOf(ravi.uid, "class_rescheduled");
    assert.equal(changed.length, 1);
    assert.match(changed[0].message, /now Wednesday, 18:00–19:00 IST \(previously Monday, 18:00–19:00 IST\)/);
    const mail = deliveredTo(ravi.email).filter((m) => m.subject === "Your Swaraanjanam Class Schedule Has Changed");
    assert.equal(mail.length, 1);
    assert.ok(mail[0].text.includes("Previous schedule: Monday, 18:00–19:00 IST") && mail[0].text.includes("New schedule: Wednesday, 18:00–19:00 IST"));
    record("5. Individual class scheduling", "PASS");
  });

  const classId = `cls-${run}`;
  test("6. class rescheduling — updateClass Server Action; an edit without a time change does not notify", async () => {
    await db.collection("liveClasses").doc(classId).set({
      studentId: asha.uid, title: "Varisai practice", status: "scheduled", startAt: Timestamp.fromDate(new Date("2027-01-15T13:30:00Z")), endAt: Timestamp.fromDate(new Date("2027-01-15T14:30:00Z")),
      timeZone: "Asia/Kolkata", date: "2027-01-15", startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", notes: null, packageId: null, batchId: null, billingAccountId: null, sessionKey: null, attendance: null,
    });
    actAs(teacher);
    const input = { studentId: asha.uid, title: "Varisai practice", date: "2027-01-16", startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", notes: "" };
    ok(await classActions.updateClass(classId, input));
    ok(await classActions.updateClass(classId, { ...input, notes: "Bring sruti box" }));
    await settle();
    const n = (await notificationsOf(asha.uid, "class_rescheduled")).filter((x) => x.relatedRecordId === classId);
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "Class rescheduled");
    assert.match(n[0].message, /“Varisai practice” has moved from Fri, 15 Jan 2027 · 7:00 pm – 8:00 pm IST to Sat, 16 Jan 2027 · 7:00 pm – 8:00 pm IST\./);
    const mail = deliveredTo(asha.email).filter((m) => m.subject === "Class Rescheduled — Swaraanjanam");
    assert.equal(mail.length, 1);
    assert.ok(mail[0].text.includes("Previous schedule: Fri, 15 Jan 2027") && mail[0].text.includes("New schedule: Sat, 16 Jan 2027"));
    record("6. Class rescheduling", "PASS");
  });

  test("7. class cancellation — cancelClass Server Action; repeat refused", async () => {
    actAs(teacher);
    ok(await classActions.cancelClass(classId, "Teacher unwell", "academy"));
    assert.equal((await classActions.cancelClass(classId, "Teacher unwell", "academy")).ok, false);
    await settle();
    const n = await notificationsOf(asha.uid, "class_cancelled");
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "Class cancelled");
    assert.match(n[0].message, /“Varisai practice” on Sat, 16 Jan 2027 · 7:00 pm – 8:00 pm IST was cancelled by the academy\. Teacher unwell/);
    assert.equal(deliveredTo(asha.email).filter((m) => m.subject === "Class Cancelled — Swaraanjanam").length, 1);
    record("7. Class cancellation", "PASS");
  });

  test("8. new class recording — setClassRecording Server Action; saving the same video again does not duplicate", async () => {
    const recId = `rec-${run}`;
    await db.collection("liveClasses").doc(recId).set({
      studentId: asha.uid, title: "Alankaram", status: "completed", attendance: "attended", startAt: Timestamp.fromDate(new Date("2026-11-07T13:30:00Z")), endAt: Timestamp.fromDate(new Date("2026-11-07T14:30:00Z")),
      timeZone: "Asia/Kolkata", date: "2026-11-07", startTime: "19:00", endTime: "20:00", meetUrl: "", packageId: null, batchId: null, billingAccountId: null, sessionKey: null,
    });
    actAs(teacher);
    ok(await classActions.setClassRecording(recId, "https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    ok(await classActions.setClassRecording(recId, "https://youtu.be/dQw4w9WgXcQ"));
    await settle();
    const n = await notificationsOf(asha.uid, "recording_available");
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "New class recording available");
    assert.match(n[0].message, /The recording of “Alankaram” \(7 Nov 2026\) is ready to watch\./);
    assert.equal(deliveredTo(asha.email).filter((m) => m.subject === "New Class Recording Available — Swaraanjanam").length, 1);
    record("8. New class recording", "PASS");
  });

  let invoiceId;
  test("9 + 10. monthly invoice and payment-due reminder — scheduled billing job; re-runs do not duplicate", async () => {
    const accountId = `ba_${asha.uid}_${COURSE}_batch`;
    const acc = await db.collection("billingAccounts").doc(accountId).get();
    const realAccountId = acc.exists ? accountId : (await db.collection("billingAccounts").where("studentId", "==", asha.uid).get()).docs[0].id;
    // Three classes held in November (the first is covered by the initial payment).
    for (const n of [1, 2, 3]) {
      const start = Date.parse("2026-11-07T13:30:00.000Z") + (n - 1) * 7 * 86_400_000;
      const ref = db.collection("liveClasses").doc(`nov-${n}-${run}`);
      await ref.set({
        studentId: asha.uid, title: `Class ${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), timeZone: "Asia/Kolkata",
        date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "19:00", endTime: "20:00", meetUrl: "", status: "scheduled", attendance: null,
        packageId: null, batchId: `batch-${run}`, sessionKey: `s${n}-${run}`, billingAccountId: realAccountId,
      });
      const { mapLiveClass } = await import("@/lib/lms/server/classes");
      const cls = mapLiveClass(await ref.get());
      await db.runTransaction(async (tx) => billing.applyClassCharge(tx, await billing.prepareClassCharge(tx, cls, "attended", "2026-11-30T00:00:00.000Z"), { uid: teacher.uid, email: teacher.email }));
    }
    const job = { uid: "scheduler", email: null };
    await billing.runScheduledBilling(job, "2026-11-30T17:45:00.000Z");
    await billing.runScheduledBilling(job, "2026-11-30T17:50:00.000Z");
    await settle();
    const inv = await notificationsOf(asha.uid, "invoice_generated");
    assert.equal(inv.length, 1);
    invoiceId = inv[0].relatedRecordId;
    assert.equal(inv[0].title, "Monthly invoice generated");
    assert.match(inv[0].message, /^Your November 2026 invoice for Swara Foundation is ₹800, payable by 3 Dec 2026/);
    assert.equal(inv[0].link, "/dashboard/billing");
    assert.equal(deliveredTo(asha.email).filter((m) => m.subject === "Your November 2026 Invoice — Swaraanjanam").length, 1);
    assert.equal((await notificationsOf(asha.uid, "payment_due")).length, 0, "no reminder in the same run as the invoice");
    record("9. Monthly invoice generated", "PASS");

    await billing.runScheduledBilling(job, "2026-12-02T06:00:00.000Z");
    await billing.runScheduledBilling(job, "2026-12-02T12:00:00.000Z");
    await settle();
    const due = await notificationsOf(asha.uid, "payment_due");
    assert.equal(due.length, 1);
    assert.equal(due[0].title, "Payment due");
    assert.match(due[0].message, /^Reminder: ₹800 for your November 2026 invoice is due by 3 Dec 2026/);
    assert.equal(deliveredTo(asha.email).filter((m) => m.subject === "Payment Reminder — Swaraanjanam").length, 1);
    record("10. Payment due reminder", "PASS");
  });

  test("11. payment received — teacher records a verified manual payment; re-notifying the same payment does not duplicate", async () => {
    actAs(teacher);
    // A pending (unverified) manual payment never notifies.
    const pending = ok(await paymentActions.recordPayment({ invoiceId, amount: "1", method: "upi", reference: `UPI-P-${run}`, paidAt: "2026-11-10", status: "pending", notes: "", verifiedConfirmation: false }));
    await settle();
    assert.equal((await db.collection("notifications").where("relatedRecordId", "==", pending.paymentId).get()).size, 0);
    const { paymentId } = ok(
      await paymentActions.recordPayment({ invoiceId, amount: "800", method: "upi", reference: `UPI-${run}`, paidAt: "2026-11-10", status: "paid", notes: "", verifiedConfirmation: true }),
    );
    await ev.notifyVerifiedPayment(paymentId, "manual"); // repeated trigger
    await settle();
    const n = await notificationsOf(asha.uid, "payment_received");
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "Payment received");
    assert.match(n[0].message, /^₹800 received for monthly invoice\./);
    const receiptId = (await db.collection("payments").doc(paymentId).get()).get("receiptId");
    assert.equal(n[0].link, receiptId ? `/receipts/${receiptId}` : "/dashboard/billing");
    assert.equal(deliveredTo(asha.email).filter((m) => m.subject === "Payment Received — Swaraanjanam").length, 1);
    record("11. Payment received", "PASS");
  });
});

describe("reliability, secrets and access", () => {
  test("Resend down: the verified payment and registration still commit; the email is retried and delivered once", async () => {
    const late = await account("late", "student");
    const { rid, orderId } = await pendingRegistration(late, "batch", 40_000);
    resend.mode = "fail";
    const before = resend.calls.length;
    const r = await postWebhook(`evt_L${run}`, "payment.captured", captured(orderId, `pay_L${run}`, 40_000));
    await settle();
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, "recorded");
    assert.equal((await db.collection("registrations").doc(rid).get()).get("status"), "paid");
    assert.equal((await db.collection("payments").doc(`rzp_pay_L${run}`).get()).get("status"), "paid");
    assert.equal((await notificationsOf(late.uid)).length, 2, "in-app notifications are stored even though email failed");
    assert.ok(resend.calls.length > before, "Resend was called");
    const failed = await outboxOf(late.uid);
    assert.ok(failed.length === 2 && failed.every((o) => o.status === "failed" && /Resend unavailable/.test(o.lastError)));
    assert.ok(failed.every((o) => !String(o.lastError).includes(RESEND_KEY)), "API key never logged");

    resend.mode = "ok";
    const retried = await svc.retryFailedEmails(Date.now() + 60 * 60 * 1000);
    assert.ok(retried.sent >= 2);
    await svc.retryFailedEmails(Date.now() + 2 * 60 * 60 * 1000);
    assert.ok((await outboxOf(late.uid)).every((o) => o.status === "sent"));
    assert.equal(deliveredTo(late.email).length, 2);
    // Each Resend call carries the outbox id as Idempotency-Key and the key only in the Authorization header.
    for (const c of resend.calls) {
      assert.match(c.key, /^n_[a-f0-9]{40}$/);
      assert.equal(c.auth, `Bearer ${RESEND_KEY}`);
      assert.ok(!JSON.stringify(c.body).includes(RESEND_KEY));
    }
  });

  test("API keys stay server-side: no client module reaches the email transport or reads RESEND_API_KEY", () => {
    const root = new URL("../../src/", import.meta.url).pathname;
    const files = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(root);
    const client = files.filter((f) => /^["']use client["']/.test(readFileSync(f, "utf8").trimStart()));
    for (const f of client) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/notifications\/(service|transport|events)|resend|RESEND_API_KEY/.test(src), `client module imports email code: ${f}`);
    }
    for (const f of files) assert.ok(!readFileSync(f, "utf8").includes("NEXT_PUBLIC_RESEND"), f);
    const transport = readFileSync(join(root, "lib/notifications/transport.ts"), "utf8");
    assert.match(transport, /^import "server-only";/);
    assert.equal(files.filter((f) => readFileSync(f, "utf8").includes("RESEND_API_KEY")).map((f) => f.slice(root.length)).join(), "lib/notifications/transport.ts");
  });

  test("access: each student sees and updates only their own notifications; teachers and signed-out users are refused", async () => {
    actAs(ravi);
    const mine = ok(await studentActions.getMyNotifications());
    assert.ok(mine.items.length > 0);
    const ashaIds = (await notificationsOf(asha.uid)).map((n) => n.id);
    assert.ok(mine.items.every((n) => !ashaIds.includes(n.id)));
    const denied = await studentActions.markMyNotificationRead(ashaIds[0]);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /could not be found/);
    ok(await studentActions.markAllMyNotificationsRead());
    assert.ok((await notificationsOf(asha.uid)).some((n) => !n.isRead), "Ravi's mark-all never touches Asha's");
    actAs(teacher);
    assert.equal((await studentActions.getMyNotifications()).ok, false);
    actAs(null);
    assert.equal((await studentActions.getMyNotifications()).ok, false);
    actAs(asha);
    ok(await studentActions.markMyNotificationRead(ashaIds[0]));
    assert.equal((await db.collection("notifications").doc(ashaIds[0]).get()).get("isRead"), true);
  });
});
