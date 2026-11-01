// Seeds the local Firebase EMULATORS with test accounts and data for signed-in
// browser testing. Refuses to run against anything but the emulators.
//
//   npm run emulators        (in one terminal)
//   npm run seed:emulator    (once the emulators are up)
//   npm run dev:emulator     (then sign in at http://localhost:3100/login)
//
// Test accounts (emulator only — they do not exist in production):
//   teacher@swaranjanam.test   — teacher (academy administrator)
//   asha@swaranjanam.test      — batch student, old dues verified, ₹400 advance awaiting
//   bala@swaranjanam.test      — enrolled, old dues NOT verified (adding to a batch is refused)
//   chitra@swaranjanam.test    — November 2026 invoice: 8 classes − verified advance = ₹2,800
//   devi@swaranjanam.test      — unpaid November invoice after the deadline → access suspended
//   esha@swaranjanam.test      — individual one-to-one sessions (₹750 each)
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
const { paymentDeadline } = await import("@/lib/lms/class-billing");
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
  price: null, originalPrice: null, tag: null, featured: true, outcomes: [], outcomesMl: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
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
  await batchRef.set({ name: "Saturday evening (test)", courseId: course, courseTitle: "Swara Foundation (test)", teacherId: teacherUid, teacherName: "Test Teacher", schedule: "Saturdays, 7–8 PM IST", meetUrl: "https://meet.google.com/abc-defg-hij", capacity: 5, memberCount: 0, status: "active", createdAt: FieldValue.serverTimestamp() });
}
const accounts = {};
for (const [uid, name] of [[asha, "Asha (test)"], [chitra, "Chitra (test)"], [devi, "Devi (test)"]]) {
  try {
    accounts[uid] = (await addMemberTx(teacher, batchId, { uid, name })).accountId;
  } catch {
    accounts[uid] = `ba_${uid}_${course}_batch`; // already a member (seed re-run)
  }
}

/** Creates a past November 2026 batch class for one student and records its outcome (as recordClassOutcome does). */
async function novemberClass(uid, n, outcome) {
  const start = Date.parse(`2026-11-${String(n * 3).padStart(2, "0")}T13:30:00.000Z`);
  const ref = db.collection("liveClasses").doc(`seed-${uid}-${n}`);
  await ref.set({
    studentId: uid, title: `Varisai practice ${n}`, startAt: Timestamp.fromMillis(start), endAt: Timestamp.fromMillis(start + 3_600_000), timeZone: "Asia/Kolkata",
    date: new Date(start + 19_800_000).toISOString().slice(0, 10), startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", notes: null,
    status: "completed", attendance: outcome, cancelKind: null, packageId: null, batchId, sessionKey: `seed-session-${n}`, billingAccountId: accounts[uid], createdBy: teacherUid,
  });
  const cls = mapLiveClass(await ref.get());
  await db.runTransaction(async (tx) => billing.applyClassCharge(tx, await billing.prepareClassCharge(tx, cls, outcome, "2026-11-30T00:00:00.000Z"), teacher));
}

// Chitra: verified advance + 8 November classes → ₹3,200 − ₹400 = ₹2,800.
const chitraAccount = await billing.mapAccount(await db.collection("billingAccounts").doc(accounts[chitra]).get());
if (chitraAccount.advance.status === "awaiting") {
  await db.runTransaction(async (tx) => billing.applyVerifiedPayment(tx, await billing.readPaymentTarget(tx, { kind: "advance", accountId: accounts[chitra] }), "seed-advance", teacher));
}
for (let n = 1; n <= 8; n++) await novemberClass(chitra, n, n === 3 ? "absent" : "attended");
await billing.generateMonthlyInvoice(accounts[chitra], "2026-11", teacher, "2026-12-01T00:00:00.000Z");

// Devi: unpaid November invoice evaluated after the deadline → suspended (reversible).
for (let n = 1; n <= 2; n++) await novemberClass(devi, n, "attended");
await billing.generateMonthlyInvoice(accounts[devi], "2026-11", teacher, "2026-12-01T00:00:00.000Z");
await billing.evaluateSuspension(accounts[devi], teacher, Date.parse(paymentDeadline("2026-11")) + 1);

// Esha: individual sessions account (old dues verified).
const eshaAccountId = `ba_${esha}_${course}_individual`;
if (!(await db.collection("billingAccounts").doc(eshaAccountId).get()).exists) {
  await db.collection("billingAccounts").doc(eshaAccountId).set({
    studentId: esha, courseId: course, mode: "individual", status: "active", batchId: null, studentName: "Esha (test)", courseTitle: "Swara Foundation (test)",
    advance: { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null }, suspension: { active: false, since: null, invoiceIds: [], liftedAt: null }, billableCount: 0,
    createdAt: FieldValue.serverTimestamp(), createdBy: teacherUid, history: [],
  });
}

console.log("Emulator seeded. Accounts and password are listed at the top of scripts/seed-emulator.mjs.");
process.exit(0);
