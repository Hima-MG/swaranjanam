// Seeds the local Firebase EMULATORS with test accounts and data for signed-in
// browser testing. Refuses to run against anything but the emulators.
//
//   npm run emulators        (in one terminal)
//   npm run seed:emulator    (once the emulators are up)
//   npm run dev:emulator     (then sign in at http://localhost:3100/login)
//
// Test accounts (emulator only — they do not exist in production):
//   teacher@swaranjanam.test   — teacher (academy administrator)
//   asha@swaranjanam.test      — batch student, old dues verified, ₹400 first-class payment awaiting
//   bala@swaranjanam.test      — enrolled, old dues NOT verified (adding to a batch is refused)
//   chitra@swaranjanam.test    — 8 weekly classes from 7 Nov 2026: November invoice ₹1,600 − ₹400 initial payment = ₹1,200; December ₹1,600
//   devi@swaranjanam.test      — unpaid November invoice after its 3 Dec deadline → access suspended
//   esha@swaranjanam.test      — individual one-to-one sessions (₹750 each, monthly invoice)
//   farah@swaranjanam.test     — website registration (batch), initial payment not made yet (retry from /dashboard/enrol)
//   gita@swaranjanam.test      — website registration (batch), ₹400 verified → Paid — Awaiting Batch Assignment
//   hari@swaranjanam.test      — website registration (individual), ₹750 verified → Paid — Awaiting Schedule Confirmation
//   indu@swaranjanam.test      — Learn Together (shared batch, Indu & Jaya), ₹720 verified → Paid — Awaiting Batch Assignment
// Password for every test account: Swaraanjanam-Test-1
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-swaranjanam";
// Always the local emulators: with these set, the Admin SDK never contacts Google.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = `seed@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_ADMIN_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });

const PASSWORD = "Swaraanjanam-Test-1";
const { getAdminAuth, getAdminDb } = await import("@/lib/firebase/admin");
const { addMemberTx } = await import("@/lib/lms/server/batches");
const billing = await import("@/lib/lms/server/class-billing");
const { mapLiveClass } = await import("@/lib/lms/server/classes");
const registrations = await import("@/lib/lms/server/registrations");
const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

const auth = getAdminAuth();
const db = getAdminDb();
if (db.projectId !== PROJECT) throw new Error("Not the demo project");

async function user(email, displayName, role = "student") {
  let record;
  try {
    record = await auth.getUserByEmail(email);
  } catch {
    record = await auth.createUser({ email, password: PASSWORD, displayName, emailVerified: true });
  }
  if (role === "teacher") await auth.setCustomUserClaims(record.uid, { role: "teacher" });
  await db.collection("users").doc(record.uid).set(
    { uid: record.uid, email, displayName, phone: null, role, provider: "password", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return record.uid;
}

const teacherUid = await user("teacher@swaranjanam.test", "Test Teacher", "teacher");
const teacher = { uid: teacherUid, email: "teacher@swaranjanam.test", name: "Test Teacher", role: "teacher" };
const [asha, bala, chitra, devi, esha] = await Promise.all([
  user("asha@swaranjanam.test", "Asha (test)"),
  user("bala@swaranjanam.test", "Bala (test)"),
  user("chitra@swaranjanam.test", "Chitra (test)"),
  user("devi@swaranjanam.test", "Devi (test)"),
  user("esha@swaranjanam.test", "Esha (test)"),
]);

const course = "swara-foundation-test";
await db.collection("courses").doc(course).set({
  id: course, slug: course, title: "Swara Foundation (test)", titleMl: "", description: "Emulator test course.", descriptionMl: "", status: "published",
  teacherIds: [teacherUid], subtitle: "", subtitleMl: "", level: "Beginner", category: "Foundations", format: "Live Online", duration: "", ageGroup: "", instructor: "Test Teacher",
  price: null, originalPrice: null, tag: null, featured: true, outcomes: [], outcomesMl: [], availability: "open", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
});
for (const uid of [asha, bala, chitra, devi, esha]) {
  await db.collection("enrollments").doc(`${course}_${uid}`).set({ id: `${course}_${uid}`, studentId: uid, courseId: course, status: "active", enrolledAt: FieldValue.serverTimestamp(), enrolledBy: teacherUid, revokedAt: null, agreedFee: null, currency: "INR" });
}
// Old dues verified for everyone except Bala.
for (const uid of [asha, chitra, devi, esha]) {
  await db.collection("legacyDues").doc(uid).set({ studentId: uid, status: "no_previous_dues", note: "Emulator test data", verifiedBy: teacherUid, verifiedByEmail: teacher.email, verifiedAt: FieldValue.serverTimestamp() });
}

const batchId = "batch-saturday-test";
const batchRef = db.collection("batches").doc(batchId);
if (!(await batchRef.get()).exists) {
  await batchRef.set({ name: "Saturday evening (test)", courseId: course, courseTitle: "Swara Foundation (test)", teacherId: teacherUid, teacherName: "Test Teacher", schedule: "Saturday, 19:00–20:00 IST", days: ["sat"], startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", capacity: 5, memberCount: 0, status: "active", createdAt: FieldValue.serverTimestamp() });
}
const accounts = {};
for (const [uid, name] of [[asha, "Asha (test)"], [chitra, "Chitra (test)"], [devi, "Devi (test)"]]) {
  try {
    accounts[uid] = (await addMemberTx(teacher, batchId, { uid, name })).accountId;
  } catch {
    accounts[uid] = `ba_${uid}_${course}_batch`; // already a member (seed re-run)
  }
}

/** Creates weekly batch class n (Saturdays from 7 Nov 2026, 7 PM IST) and records its outcome (as recordClassOutcome does). */
async function weeklyClass(uid, n, outcome) {
  const start = Date.parse("2026-11-07T13:30:00.000Z") + (n - 1) * 7 * 86_400_000;
  const ref = db.collection("liveClasses").doc(`seed-${uid}-${n}`);
  await ref.set({
    studentId: uid, title: `Varisai practice ${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), timeZone: "Asia/Kolkata",
    date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", notes: null,
    status: "completed", attendance: outcome, cancelKind: null, packageId: null, batchId, sessionKey: `seed-session-${n}`, billingAccountId: accounts[uid], createdBy: teacherUid,
  });
  const cls = mapLiveClass(await ref.get());
  await db.runTransaction(async (tx) => billing.applyClassCharge(tx, await billing.prepareClassCharge(tx, cls, outcome, "2026-11-30T00:00:00.000Z"), teacher));
}

// Chitra: first-class payment verified + 8 weekly classes → November ₹1,600 − ₹400 deducted; December ₹1,600.
const chitraAccount = billing.mapAccount(await db.collection("billingAccounts").doc(accounts[chitra]).get());
if (chitraAccount.advance.status === "awaiting") {
  await db.runTransaction(async (tx) => billing.applyVerifiedPayment(tx, await billing.readPaymentTarget(tx, { kind: "advance", accountId: accounts[chitra] }), "seed-advance", teacher));
}
for (let n = 1; n <= 8; n++) await weeklyClass(chitra, n, n === 3 ? "absent" : "attended");
// Monthly invoices are generated from 23:00 IST on the last day of each month.
await billing.issueDueMonthlyInvoices(accounts[chitra], teacher, "2026-11-30T17:30:00.000Z");
await billing.issueDueMonthlyInvoices(accounts[chitra], teacher, "2026-12-31T17:30:00.000Z");

// Devi: first-class payment verified, classes 1–3, November invoice unpaid after its 3 Dec deadline → suspended (reversible).
const deviAccount = billing.mapAccount(await db.collection("billingAccounts").doc(accounts[devi]).get());
if (deviAccount.advance.status === "awaiting") {
  await db.runTransaction(async (tx) => billing.applyVerifiedPayment(tx, await billing.readPaymentTarget(tx, { kind: "advance", accountId: accounts[devi] }), "seed-advance-devi", teacher));
}
for (let n = 1; n <= 3; n++) await weeklyClass(devi, n, "attended");
await billing.issueDueMonthlyInvoices(accounts[devi], teacher, "2026-11-30T17:30:00.000Z");
await billing.evaluateSuspension(accounts[devi], teacher, Date.parse("2026-12-03T18:30:00.000Z")); // just after the deadline

// Esha: individual sessions account (old dues verified).
const eshaAccountId = `ba_${esha}_${course}_individual`;
if (!(await db.collection("billingAccounts").doc(eshaAccountId).get()).exists) {
  await db.collection("billingAccounts").doc(eshaAccountId).set({
    studentId: esha, courseId: course, mode: "individual", status: "active", batchId: null, studentName: "Esha (test)", courseTitle: "Swara Foundation (test)",
    advance: { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null }, suspension: { active: false, since: null, invoiceIds: [], liftedAt: null }, billableCount: 0,
    createdAt: FieldValue.serverTimestamp(), createdBy: teacherUid, history: [],
  });
}

// Website registrations (pay first; the academy then assigns a batch or confirms the schedule).
const [farah, gita, hari, indu] = await Promise.all([
  user("farah@swaranjanam.test", "Farah (test)"),
  user("gita@swaranjanam.test", "Gita (test)"),
  user("hari@swaranjanam.test", "Hari (test)"),
  user("indu@swaranjanam.test", "Indu & Jaya (test)"),
]);
for (const uid of [gita, hari, indu]) {
  await db.collection("legacyDues").doc(uid).set({ studentId: uid, status: "no_previous_dues", note: "Emulator test data", verifiedBy: teacherUid, verifiedByEmail: teacher.email, verifiedAt: FieldValue.serverTimestamp() });
}
const learner = (fullName, overrides = {}) => ({
  fullName, mobile: "+919800000000", age: "", dateOfBirth: "", address: "Test address, Thrissur", preferredDays: ["sat", "sun"],
  preferredTimes: [{ start: "19:00", end: "20:00" }, { start: "10:00", end: "11:00" }], notes: "Emulator test registration", ...overrides,
});
for (const [uid, email, mode, details, pay] of [
  [farah, "farah@swaranjanam.test", "batch", learner("Farah (test)", { age: "29" }), false],
  [gita, "gita@swaranjanam.test", "batch", learner("Gita (test)", { dateOfBirth: "2014-06-01", guardianName: "Parent (test)", guardianRelationship: "Mother", guardianPhone: "+91 90000 00000" }), true],
  [hari, "hari@swaranjanam.test", "individual", learner("Hari (test)", { age: "41", preferredDays: ["wed"] }), true],
  // Learn Together: two learners, one login.
  [indu, "indu@swaranjanam.test", "shared_batch", learner("Indu (test)", { learners: [{ fullName: "Indu (test)", age: "38" }, { fullName: "Jaya (test)", age: "36" }] }), true],
]) {
  const student = { uid, email, name: details.fullName, role: "student" };
  let registrationId = `${uid}_${course}`;
  try {
    registrationId = (await registrations.saveRegistration(student, { slug: course, mode, details })).registrationId;
  } catch (error) {
    // Already paid (seed re-run) is expected; anything else is reported.
    if (!/already registered/.test(String(error?.message))) console.warn("[seed] registration:", error?.message, error?.fieldErrors ?? "");
  }
  if (pay) {
    try {
      await db.runTransaction(async (tx) => billing.applyVerifiedPayment(tx, await billing.readPaymentTarget(tx, { kind: "registration", registrationId }), `seed-registration-${uid}`, teacher));
    } catch {
      // Already paid (seed re-run).
    }
  }
}

console.log("Emulator seeded. Accounts and password are listed at the top of scripts/seed-emulator.mjs.");
process.exit(0);
