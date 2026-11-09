// Creates the academy's two MAIN course records — Swara Foundation (Adults)
// and Little Swaras (Kids) — from the approved catalogue
// (src/data/approved-courses.ts), if they do not exist yet.
//
// Safe to run repeatedly — it never duplicates, overwrites or deletes:
//   * A course is skipped if any record already uses its slug (as id or
//     slug) or its title (lib/lms/academy-courses.ts → planMainCourseCreation).
//   * Documents are written with create(), which fails if the id exists.
//   * Only approved details are used. No pricing is stored, so the academy's
//     confirmed rates keep applying exactly as on the public site today, and
//     the course is published with the same availability the site shows now.
//
// Usage:
//   npm run courses:create-main                      (local emulators, writes)
//   npm run courses:create-main -- --production      (real project, DRY RUN)
//   npm run courses:create-main -- --production --apply   (real project, writes)
import { generateKeyPairSync } from "node:crypto";

const args = process.argv.slice(2);
const production = args.includes("--production");
const apply = args.includes("--apply");
const unknown = args.filter((a) => a !== "--production" && a !== "--apply");
if (unknown.length) {
  console.error(`Unknown arguments: ${unknown.join(" ")}`);
  process.exit(1);
}

if (production) {
  const { default: nextEnv } = await import("@next/env");
  nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
} else {
  const PROJECT = "demo-swaranjanam";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL = `seed@${PROJECT}.iam.gserviceaccount.com`;
  process.env.FIREBASE_ADMIN_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
}
const write = production ? apply : true;

const { getAdminDb } = await import("@/lib/firebase/admin");
const { mainCourseFields, planMainCourseCreation } = await import("@/lib/lms/academy-courses");
const { FieldValue } = await import("firebase-admin/firestore");

const db = getAdminDb();
if (!production && db.projectId !== "demo-swaranjanam") throw new Error("Not the demo project");
console.log(`Project: ${db.projectId}${production ? " (PRODUCTION)" : " (emulator)"}${write ? "" : " — dry run, nothing will be written"}`);

const snap = await db.collection("courses").select("slug", "title").get();
const existing = snap.docs.map((d) => ({ id: d.id, slug: d.get("slug") ?? null, title: d.get("title") ?? null }));
const plan = planMainCourseCreation(existing);

for (const s of plan.skip) console.log(`• ${s.slug}: ${s.reason} — left unchanged`);
for (const course of plan.create) {
  if (write) {
    await db.collection("courses").doc(course.slug).create({ ...mainCourseFields(course), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  }
  console.log(`${write ? "✔ created" : "○ would create"} courses/${course.slug} — ${course.title}`);
}
if (plan.create.length === 0) console.log("Nothing to create.");
else if (write && production) console.log("\nThe public catalogue is cached for up to an hour; editing any course in the teacher dashboard refreshes it.");
process.exit(0);
