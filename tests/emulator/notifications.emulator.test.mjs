// Firestore EMULATOR tests for student notifications and their emails.
// Run with: npm run test:emulator  (demo- project; never production; no real email:
// the email transport is replaced by an in-memory fake).
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";

const PROJECT = "demo-swaranjanam";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST) throw new Error("FIRESTORE_EMULATOR_HOST is not set: run these tests with `npm run test:emulator`.");
process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "emulator@demo-swaranjanam.iam.gserviceaccount.com";
process.env.FIREBASE_ADMIN_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
delete process.env.RESEND_API_KEY;

const { getAdminDb } = await import("@/lib/firebase/admin");
const { addMemberTx, transferMemberTx } = await import("@/lib/lms/server/batches");
const { processVerifiedGatewayPayment, recordGatewayPaymentFailure } = await import("@/lib/lms/server/gateway");
const svc = await import("@/lib/notifications/service");
const ev = await import("@/lib/notifications/events");
const { setEmailTransportForTests } = await import("@/lib/notifications/transport");
const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

const db = getAdminDb();
const run = randomUUID().slice(0, 8);
const id = (s) => `${s}-${run}`;
const teacher = { uid: "teacher-n", email: "teacher@example.test", name: "Teacher", role: "teacher" };
const student = (uid) => ({ uid, email: `${uid}@example.test`, name: uid, role: "student" });
const course = id("course");

/** In-memory email transport: records sends; can be switched to fail. */
const outbox = { sent: [], fail: false };
setEmailTransportForTests({
  name: "fake",
  async send(email) {
    if (outbox.fail) throw new Error("Resend: rate_limit_exceeded: Too many requests");
    outbox.sent.push(email);
    return { id: `fake_${outbox.sent.length}` };
  },
});

const clearAll = () => fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
before(clearAll);
after(async () => {
  setEmailTransportForTests(null);
  await clearAll();
});
beforeEach(() => {
  outbox.fail = false;
});

async function profile(uid) {
  await db.collection("users").doc(uid).set({ email: `${uid}@example.test`, role: "student", displayName: uid });
  return uid;
}
const notificationsOf = async (uid) => (await db.collection("notifications").where("userId", "==", uid).get()).docs.map((d) => d.data());
const settle = () => svc.settleEmailDeliveries();
const emailsTo = (uid) => outbox.sent.filter((e) => e.to === `${uid}@example.test`);

async function batchWithMember(uid, name = "Evening Beginners") {
  const batchId = id(`batch-${uid}-${name.length}`);
  await db.collection("batches").doc(batchId).set({
    name, courseId: course, courseTitle: "Swara Foundation", teacherId: teacher.uid, teacherName: "Smt. Anjana",
    schedule: "", days: ["tue", "sat"], startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", capacity: 5, memberCount: 0, status: "active",
  });
  await db.collection("enrollments").doc(`${course}_${uid}`).set({ id: `${course}_${uid}`, studentId: uid, courseId: course, status: "active", agreedFee: null, currency: "INR" });
  await db.collection("legacyDues").doc(uid).set({ studentId: uid, status: "no_previous_dues", note: "test", verifiedBy: teacher.uid, verifiedAt: FieldValue.serverTimestamp() });
  return batchId;
}

describe("registration and payments", () => {
  test("1. registration completed after a verified payment: in-app + email with the required details", async () => {
    const uid = await profile(id("reg"));
    const rid = id("registration");
    await db.collection("registrations").doc(rid).set({
      studentId: uid, studentEmail: `${uid}@example.test`, courseSlug: "swara", courseTitle: "Swara Foundation", mode: "batch", enrolmentType: "batch",
      status: "paid", initialAmountMinor: 40_000, details: { fullName: "Asha Menon", email: `${uid}@example.test`, learners: [] },
    });
    await db.collection("payments").doc(`rzp_${rid}`).set({ studentId: uid, amountMinor: 40_000, purpose: "registration", registrationId: rid, receiptId: `rzp_${rid}`, status: "paid", verified: true, needsReview: false });
    await ev.notifyVerifiedPayment(`rzp_${rid}`, "online");
    await settle();
    const types = (await notificationsOf(uid)).map((n) => n.type).sort();
    assert.deepEqual(types, ["payment_success", "registration_completed"]);
    const mail = emailsTo(uid).find((e) => e.subject === "Your Swaraanjanam Registration is Complete");
    assert.ok(mail);
    for (const s of ["Asha Menon", "Swara Foundation", "Batch – Individual", "Paid — Awaiting Batch Assignment", "Paid (verified)", "Next steps"]) assert.ok(mail.text.includes(s), s);
  });

  test("an unverified (pending) payment never notifies", async () => {
    const uid = await profile(id("unverified"));
    await db.collection("payments").doc(id("pending-pay")).set({ studentId: uid, amountMinor: 100, purpose: "invoice", status: "pending", verified: false });
    await ev.notifyVerifiedPayment(id("pending-pay"), "manual");
    assert.equal((await notificationsOf(uid)).length, 0);
  });

  test("2 + 8. server-verified Razorpay payment notifies once across checkout, recovery and webhook redeliveries", async () => {
    const uid = await profile(id("gw"));
    const batchId = await batchWithMember(uid);
    const { accountId } = await addMemberTx(teacher, batchId, { uid, name: uid });
    await db.collection("gatewayOrders").doc(id("order")).set({ target: { kind: "advance", accountId }, mode: "test", studentId: uid, amountMinor: 40_000, currency: "INR", status: "created" });
    const p = { orderId: id("order"), paymentId: id("pay"), amountMinor: 40_000, currency: "INR", status: "captured" };
    const outcomes = await Promise.all([
      processVerifiedGatewayPayment({ ...p, via: "checkout" }),
      processVerifiedGatewayPayment({ ...p, via: "webhook" }),
      processVerifiedGatewayPayment({ ...p, via: "webhook" }),
    ]);
    assert.equal(outcomes.filter((o) => o.outcome === "recorded").length, 1);
    await processVerifiedGatewayPayment({ ...p, via: "recovery" });
    await settle();
    const paid = (await notificationsOf(uid)).filter((n) => n.type === "payment_success");
    assert.equal(paid.length, 1);
    assert.equal(emailsTo(uid).filter((e) => e.subject === "Payment Successful — Swaraanjanam").length, 1);
    // Not captured (e.g. browser said "success" but Razorpay has not captured): nothing is sent.
    const uid2 = await profile(id("gw-auth"));
    await db.collection("gatewayOrders").doc(id("order2")).set({ target: { kind: "advance", accountId }, mode: "test", studentId: uid2, amountMinor: 40_000, currency: "INR", status: "created" });
    await processVerifiedGatewayPayment({ ...p, orderId: id("order2"), paymentId: id("pay2"), status: "authorized", via: "checkout" });
    assert.equal((await notificationsOf(uid2)).length, 0);
  });

  test("3. failed payment (signed webhook) notifies once per Razorpay payment", async () => {
    const uid = await profile(id("fail"));
    await db.collection("gatewayOrders").doc(id("order-f")).set({ target: { kind: "invoice", invoiceId: "x" }, mode: "test", studentId: uid, amountMinor: 75_000, currency: "INR", status: "created", description: "November invoice" });
    const f = { orderId: id("order-f"), paymentId: id("pay-f"), code: "BAD_REQUEST_ERROR", description: "Card declined" };
    await recordGatewayPaymentFailure(f);
    await recordGatewayPaymentFailure(f);
    await settle();
    const failed = (await notificationsOf(uid)).filter((n) => n.type === "payment_failed");
    assert.equal(failed.length, 1);
    assert.match(failed[0].message, /₹750/);
    assert.equal(emailsTo(uid).filter((e) => e.subject === "Payment Failed — Swaraanjanam").length, 1);
  });

  test("7. invoice generated (once), payment due and overdue notices", async () => {
    const uid = await profile(id("inv"));
    const invoiceId = id("invoice");
    await db.collection("invoices").doc(invoiceId).set({ studentId: uid, courseTitle: "Swara Foundation", amountDueMinor: 160_000, period: "2026-11", deadlineAt: Timestamp.fromDate(new Date("2026-12-03T18:29:59.999Z")) });
    await ev.notifyInvoiceIssued(invoiceId);
    await ev.notifyInvoiceIssued(invoiceId);
    await settle();
    const inv = (await notificationsOf(uid)).filter((n) => n.type === "invoice_generated");
    assert.equal(inv.length, 1);
    assert.match(inv[0].message, /November 2026/);
    assert.match(inv[0].message, /₹1,600/);
    assert.equal(inv[0].link, "/dashboard/billing");
  });
});

describe("scheduling (teacher actions)", () => {
  test("4. batch assignment: only the affected student is notified, with batch, teacher and timings; re-run is deduplicated; transfer notifies again", async () => {
    const uid = await profile(id("batch"));
    const other = await profile(id("bystander"));
    const batchId = await batchWithMember(uid);
    await addMemberTx(teacher, batchId, { uid, name: uid });
    await ev.notifyBatchAssigned({ studentId: uid, batchId });
    await ev.notifyBatchAssigned({ studentId: uid, batchId });
    await settle();
    const assigned = (await notificationsOf(uid)).filter((n) => n.type === "batch_assigned");
    assert.equal(assigned.length, 1);
    assert.match(assigned[0].message, /Tuesday & Saturday, 19:00–20:00 IST/);
    const mail = emailsTo(uid).find((e) => e.subject === "Your Swaraanjanam Class Schedule is Confirmed");
    for (const s of ["Swara Foundation", "Evening Beginners", "Smt. Anjana", "Tuesday & Saturday, 19:00–20:00 IST", "/dashboard"]) assert.ok(mail.text.includes(s), s);
    assert.equal((await notificationsOf(other)).length, 0);

    const toBatch = id("batch-to");
    await db.collection("batches").doc(toBatch).set({ name: "Morning", courseId: course, courseTitle: "Swara Foundation", teacherId: teacher.uid, teacherName: "Smt. Anjana", days: ["mon"], startTime: "07:00", endTime: "08:00", capacity: 5, memberCount: 0, status: "active" });
    const moved = await transferMemberTx(teacher, batchId, toBatch, uid);
    await ev.notifyBatchAssigned({ studentId: uid, batchId: toBatch, previousBatchName: moved.from });
    const changed = (await notificationsOf(uid)).filter((n) => n.type === "class_rescheduled");
    assert.equal(changed.length, 1);
    assert.match(changed[0].message, /from Evening Beginners to Morning/);
  });

  test("5 + 6. individual schedule confirmed, then changed (previous and new schedule)", async () => {
    const uid = await profile(id("ind"));
    const rid = id("ind-reg");
    const ref = db.collection("registrations").doc(rid);
    await ref.set({ studentId: uid, courseTitle: "Swara Foundation", mode: "individual", enrolmentType: "individual", status: "scheduled", confirmedSchedule: "Monday, 18:00–19:00 IST", scheduleTeacherName: "Smt. Anjana", details: { fullName: "Ravi", learners: [] } });
    await ev.notifyIndividualSchedule(rid, "confirmed");
    await ev.notifyIndividualSchedule(rid, "confirmed");
    await ref.update({ confirmedSchedule: "Wednesday, 18:00–19:00 IST" });
    await ev.notifyIndividualSchedule(rid, "changed", "Monday, 18:00–19:00 IST");
    await settle();
    const list = await notificationsOf(uid);
    assert.equal(list.filter((n) => n.type === "individual_scheduled").length, 1);
    const change = list.find((n) => n.type === "class_rescheduled");
    assert.match(change.message, /Wednesday, 18:00–19:00 IST \(previously Monday, 18:00–19:00 IST\)/);
    const mail = emailsTo(uid).find((e) => e.subject === "Your Swaraanjanam Class Schedule Has Changed");
    assert.ok(mail.text.includes("Previous schedule: Monday, 18:00–19:00 IST"));
    assert.ok(mail.text.includes("New schedule: Wednesday, 18:00–19:00 IST"));
  });

  test("6. class rescheduled (each real move once) and cancelled (once), only for that class's learners", async () => {
    const a = await profile(id("cls-a"));
    const b = await profile(id("cls-b"));
    const outsider = await profile(id("cls-x"));
    const mk = async (uid) => {
      const ref = db.collection("liveClasses").doc(id(`class-${uid}`));
      await ref.set({ studentId: uid, title: "Varisai practice", status: "scheduled", startAt: Timestamp.fromDate(new Date("2026-11-20T13:30:00Z")), endAt: Timestamp.fromDate(new Date("2026-11-20T14:30:00Z")) });
      return { classId: ref.id, studentId: uid };
    };
    const targets = [await mk(a), await mk(b)];
    const previous = { startAt: "2026-11-20T13:30:00.000Z", endAt: "2026-11-20T14:30:00.000Z" };
    const next = { startAt: "2026-11-21T13:30:00.000Z", endAt: "2026-11-21T14:30:00.000Z" };
    await ev.notifyClassRescheduled(targets, { title: "Varisai practice", previous, next });
    await ev.notifyClassRescheduled(targets, { title: "Varisai practice", previous, next }); // repeated action: no change
    await settle();
    assert.equal((await notificationsOf(a)).filter((n) => n.type === "class_rescheduled").length, 1);
    const mail = emailsTo(a).find((e) => e.subject === "Class Rescheduled — Swaraanjanam");
    assert.match(mail.text, /Previous schedule: .*20 Nov/);
    assert.match(mail.text, /New schedule: .*21 Nov/);

    for (const t of targets) await db.collection("liveClasses").doc(t.classId).update({ status: "cancelled" });
    await ev.notifyClassCancelled(targets, { title: "Varisai practice", ...next, kind: "academy", reason: "Teacher unwell" });
    await ev.notifyClassCancelled(targets, { title: "Varisai practice", ...next, kind: "academy", reason: "Teacher unwell" });
    assert.equal((await notificationsOf(b)).filter((n) => n.type === "class_cancelled").length, 1);
    assert.equal((await notificationsOf(outsider)).length, 0);
  });

  test("recording available: in-app, once per video", async () => {
    const uid = await profile(id("rec"));
    const t = [{ classId: id("rec-class"), studentId: uid, accountId: null }];
    await ev.notifyRecordingAvailable(t, { title: "Alankaram", date: "2026-11-14", videoId: "abc123def45" });
    await ev.notifyRecordingAvailable(t, { title: "Alankaram", date: "2026-11-14", videoId: "abc123def45" });
    assert.equal((await notificationsOf(uid)).filter((n) => n.type === "recording_available").length, 1);
  });
});

describe("student access", () => {
  test("9. read / unread: individual and mark all", async () => {
    const uid = await profile(id("reader"));
    for (const k of [1, 2, 3]) await svc.notify({ eventKey: id(`read-${k}`), userId: uid, type: "payment_due", title: `T${k}`, message: "m", relatedRecordId: null, link: "/dashboard/billing" });
    const me = student(uid);
    let view = await svc.listOwnNotifications(me);
    assert.equal(view.unreadCount, 3);
    await svc.markNotificationRead(me, view.items[0].id);
    await svc.markNotificationRead(me, view.items[0].id); // idempotent
    view = await svc.listOwnNotifications(me);
    assert.equal(view.unreadCount, 2);
    assert.equal(await svc.markAllNotificationsRead(me), 2);
    assert.equal((await svc.listOwnNotifications(me)).unreadCount, 0);
  });

  test("10. isolation: a student cannot list or mark another student's notifications; teachers are refused", async () => {
    const owner = await profile(id("owner"));
    const intruder = await profile(id("intruder"));
    await svc.notify({ eventKey: id("private"), userId: owner, type: "payment_due", title: "Private", message: "m", relatedRecordId: null, link: "/dashboard" });
    const [mine] = (await svc.listOwnNotifications(student(owner))).items;
    assert.equal((await svc.listOwnNotifications(student(intruder))).items.length, 0);
    await assert.rejects(svc.markNotificationRead(student(intruder), mine.id), /could not be found/);
    await svc.markAllNotificationsRead(student(intruder));
    assert.equal((await svc.listOwnNotifications(student(owner))).unreadCount, 1);
    await assert.rejects(svc.listOwnNotifications(teacher), /permission/);
    await assert.rejects(svc.markNotificationRead(student(intruder), "../users/x"), /could not be found/);
  });
});

describe("email reliability", () => {
  test("11. Resend failure: notification kept, failure logged on the outbox entry, retried later and delivered once with the idempotency key", async () => {
    const uid = await profile(id("resend"));
    outbox.fail = true;
    const before = outbox.sent.length;
    const outcome = await svc.notify({
      eventKey: id("resend-evt"), userId: uid, type: "invoice_generated", title: "Invoice", message: "m", relatedRecordId: null, link: "/dashboard/billing",
      email: { subject: "Invoice", heading: "h", intro: ["i"] },
    });
    assert.equal(outcome, "created");
    await settle();
    const nid = svc.notificationId(id("resend-evt"));
    const entry = (await db.collection("emailOutbox").doc(nid).get()).data();
    assert.equal(entry.status, "failed");
    assert.match(entry.lastError, /rate_limit/);
    assert.equal(entry.attempts, 1);
    assert.equal((await notificationsOf(uid)).length, 1);

    // Not yet due for retry: nothing is sent.
    outbox.fail = false;
    await svc.retryFailedEmails(Date.now());
    assert.equal(outbox.sent.length, before);
    // Later: delivered once; another retry run sends nothing more.
    const later = Date.now() + 60 * 60 * 1000;
    const r = await svc.retryFailedEmails(later);
    assert.ok(r.sent >= 1);
    await svc.retryFailedEmails(later);
    const delivered = outbox.sent.filter((e) => e.idempotencyKey === nid);
    assert.equal(delivered.length, 1);
    assert.equal((await db.collection("emailOutbox").doc(nid).get()).get("status"), "sent");
  });

  test("a guest (no account yet) gets the email only; nothing is written without a recipient", async () => {
    assert.equal(await svc.notify({ eventKey: id("nobody"), userId: null, type: "payment_failed", title: "t", message: "m", relatedRecordId: null, link: "/" }), "skipped");
    const out = await svc.notify({ eventKey: id("guest"), userId: null, emailTo: "guest@example.test", type: "payment_success", title: "t", message: "m", relatedRecordId: null, link: "/", email: { subject: "Guest", heading: "h", intro: [] } });
    assert.equal(out, "created");
    await settle();
    assert.equal(outbox.sent.filter((e) => e.to === "guest@example.test").length, 1);
  });
});
