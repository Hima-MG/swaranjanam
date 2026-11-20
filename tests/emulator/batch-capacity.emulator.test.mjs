// Firestore + Auth EMULATOR tests: batches have no maximum size. Exercises the real
// transaction (addMemberTx/removeMemberTx), the real teacher Server Actions
// (createBatch/addBatchMember/removeBatchMember), and the teacher-dashboard readers
// (listBatches/getBatchDetail) at the scales called out when this restriction was
// removed: 1, 50 and 100+ students in one batch.
//
// Run with: npm run test:emulator
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { after, before, describe, test } from "node:test";

const PROJECT = "demo-swaranjanam";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!HOST || !AUTH_HOST) throw new Error("Run with `npm run test:emulator` (Firestore + Auth emulators).");

Object.assign(process.env, {
  FIREBASE_ADMIN_PROJECT_ID: PROJECT,
  FIREBASE_ADMIN_CLIENT_EMAIL: "emulator@demo-swaranjanam.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }),
});

const { getAdminDb, getAdminAuth } = await import("@/lib/firebase/admin");
const { SESSION_COOKIE_NAME } = await import("@/lib/auth/constants");
const { addMemberTx, createBatchRecord, mapBatch, listBatches, getBatchDetail } = await import("@/lib/lms/server/batches");
const batchActions = await import("@/app/(account)/teacher/batch-actions");
const { FieldValue } = await import("firebase-admin/firestore");

const db = getAdminDb();
const auth = getAdminAuth();
const run = randomUUID().slice(0, 6).replace(/-/g, "");
const id = (s) => `${s}-${run}`;
const realFetch = globalThis.fetch;
const clearAll = () => realFetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });

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
const actAs = (who) => { globalThis.__testCookies = who ? { [SESSION_COOKIE_NAME]: who.cookie } : {}; };
const ok = (result) => { assert.equal(result.ok, true, result.ok ? "" : `action failed: ${result.error} ${JSON.stringify(result.fieldErrors ?? {})}`); return result.data; };

// synthetic (no real Auth account) learners, like the capacity tests in class-billing.emulator.test.mjs
const course = id("course");
async function enroll(studentId) {
  await Promise.all([
    db.collection("enrollments").doc(`${course}_${studentId}`).set({ id: `${course}_${studentId}`, studentId, courseId: course, status: "active", agreedFee: null, currency: "INR" }),
    db.collection("legacyDues").doc(studentId).set({ studentId, status: "no_previous_dues", note: "test", verifiedBy: teacher.uid, verifiedByEmail: teacher.email, verifiedAt: FieldValue.serverTimestamp() }),
  ]);
}
async function newBatch(name, opts = {}) {
  const ref = db.collection("batches").doc(id(name));
  await ref.set({ name, courseId: course, courseTitle: "Swara Foundation", teacherId: teacher.uid, teacherName: "Teacher", schedule: "Sat 7 PM", meetUrl: "https://meet.google.com/abc-defg-hij", memberCount: 0, status: "active", ...opts });
  return ref.id;
}
/** Adds `count` fresh synthetic learners to `batchId`, one at a time (as a teacher would), returning their uids. */
async function addLearners(batchId, count, prefix) {
  const uids = Array.from({ length: count }, (_, i) => id(`${prefix}${i}`));
  await Promise.all(uids.map(enroll));
  for (const uid of uids) await addMemberTx(teacher, batchId, { uid, name: uid });
  return uids;
}

let teacher;
before(async () => {
  await clearAll();
  await realFetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  teacher = await account("teacher", "teacher");
  teacher.role = "teacher";
  await db.collection("courses").doc(course).set({ title: "Swara Foundation", slug: id("sf"), status: "published", teacherIds: [teacher.uid] });
});
after(async () => { delete globalThis.__testCookies; await clearAll(); });

describe("batches have no maximum size", () => {
  test("a batch can be created and hold exactly 1 student, through the real Server Actions", async () => {
    actAs(teacher);
    const student = await account(`solo-${run}`, "student");
    await enroll(student.uid);
    const { batchId } = ok(await batchActions.createBatch({ name: "Solo batch", courseId: course, teacherId: teacher.uid, days: ["sat"], startTime: "19:00", endTime: "20:00", meetUrl: "https://meet.google.com/abc-defg-hij", status: "active" }));
    ok(await batchActions.addBatchMember(batchId, student.uid));
    const detail = await getBatchDetail(teacher, batchId);
    assert.equal(detail.batch.memberCount, 1);
    assert.equal(detail.members.filter((m) => m.status === "active").length, 1);
    assert.equal((await listBatches(teacher)).find((b) => b.id === batchId).memberCount, 1);
  });

  test("a batch can hold 50 students, added one at a time, with the count correct at every step", async () => {
    const batchId = await newBatch("fifty");
    const uids = Array.from({ length: 50 }, (_, i) => id(`fifty${i}`));
    await Promise.all(uids.map(enroll));
    for (let i = 0; i < uids.length; i++) {
      await addMemberTx(teacher, batchId, { uid: uids[i], name: uids[i] });
      if (i === 0 || i === 24 || i === 49) {
        assert.equal((await db.collection("batches").doc(batchId).get()).get("memberCount"), i + 1, `memberCount after adding student ${i + 1}`);
      }
    }
    const detail = await getBatchDetail(teacher, batchId);
    assert.equal(detail.batch.memberCount, 50);
    assert.equal(detail.members.length, 50);
    assert.equal((await listBatches(teacher)).find((b) => b.id === batchId).memberCount, 50);
  });

  test("a batch can hold 120 students (well past the old cap of 5), and more can still be added afterwards", async () => {
    const batchId = await newBatch("hundred");
    await addLearners(batchId, 120, "h");
    assert.equal((await db.collection("batches").doc(batchId).get()).get("memberCount"), 120);
    const detail = await getBatchDetail(teacher, batchId);
    assert.equal(detail.batch.memberCount, 120);
    assert.equal(detail.members.length, 120);

    // Adding more students to an already-large batch, through the real Server Action,
    // keeps succeeding and the count is correct on the very next read (no page refresh needed).
    actAs(teacher);
    const student1 = await account(`more1-${run}`, "student");
    const student2 = await account(`more2-${run}`, "student");
    const [extra1, extra2] = [student1.uid, student2.uid];
    await Promise.all([extra1, extra2].map(enroll));
    ok(await batchActions.addBatchMember(batchId, extra1));
    ok(await batchActions.addBatchMember(batchId, extra2));
    assert.equal((await getBatchDetail(teacher, batchId)).batch.memberCount, 122);

    // Removing students updates the count correctly and leaves the rest untouched.
    ok(await batchActions.removeBatchMember(batchId, extra1, "test cleanup"));
    const afterRemove = await getBatchDetail(teacher, batchId);
    assert.equal(afterRemove.batch.memberCount, 121);
    assert.equal(afterRemove.members.find((m) => m.studentId === extra1).status, "removed");
    assert.equal(afterRemove.members.find((m) => m.studentId === extra2).status, "active");

    // Duplicate assignment is still refused, even in a batch this large.
    await assert.rejects(addMemberTx(teacher, batchId, { uid: extra2, name: extra2 }), /already in this batch/);

    // The teacher batches list and the batch detail page agree on the actual count.
    assert.equal((await listBatches(teacher)).find((b) => b.id === batchId).memberCount, 121);
  });

  test("an existing batch saved before this change (with its old capacity field already at the old cap) still accepts new members", async () => {
    // Simulates a pre-existing Firestore document: the old code wrote a `capacity` field
    // and refused once memberCount reached it. That document is untouched here — this
    // only checks that the server no longer reads `capacity` to block anyone.
    const batchId = await newBatch("legacy", { capacity: 5, memberCount: 5 });
    const uid = id("legacy-extra");
    await enroll(uid);
    await addMemberTx(teacher, batchId, { uid, name: uid });
    const stored = await db.collection("batches").doc(batchId).get();
    assert.equal(stored.get("memberCount"), 6);
    assert.equal(stored.get("capacity"), 5, "the old field is left exactly as it was — existing data is never modified");
    assert.equal(mapBatch(stored).memberCount, 6);
  });

  test("createBatchRecord never writes a capacity field", async () => {
    const batchId = await createBatchRecord(teacher, {
      name: "No capacity field",
      course: { id: course, title: "Swara Foundation" },
      teacher: { uid: teacher.uid, name: "Teacher" },
      weekly: { days: ["sun"], start: "10:00", end: "11:00" },
      meetUrl: null,
      active: true,
    });
    assert.equal((await db.collection("batches").doc(batchId).get()).get("capacity"), undefined);
  });
});
