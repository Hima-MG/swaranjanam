#!/usr/bin/env node
/**
 * One-off import of the former static course catalogue into Firestore.
 *
 * Input: scripts/legacy-catalogue.json — a snapshot of the old
 * src/data/courses.ts, used ONLY by this script. The website never reads it;
 * Firestore is the source of truth and all course changes are made in the
 * teacher dashboard. Delete the JSON once the import has been run and verified.
 *
 * Safe to run repeatedly — it never deletes or duplicates anything:
 *   * Course documents use the existing slug as their id, so URLs are kept.
 *   * A course and its outline (modules/lessons, deterministic ids) are
 *     created ONLY if the course document does not exist yet.
 *   * For courses this script created earlier, catalogue fields that are
 *     still missing (subtitle, level, fees, outcomes …) are filled in; fields
 *     that already exist — including teacher edits — are never overwritten.
 *   * New courses are imported as "published" (they were public before), so
 *     existing /courses/<slug> links keep working. Use --status=draft to
 *     import them hidden instead.
 *
 * Usage:
 *   npm run migrate:courses -- [--dry-run] [--teacher=<email>] [--status=published|draft]
 */
import { readFileSync } from "node:fs";

import nextEnv from "@next/env";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
const dryRun = args.includes("--dry-run");
const teacherEmail = option("teacher");
const status = option("status") ?? "published";
if (!["published", "draft"].includes(status)) fail("--status must be published or draft");
const unknown = args.filter((a) => a !== "--dry-run" && !/^--(teacher|status)=/.test(a));
if (unknown.length) fail(`Unknown arguments: ${unknown.join(" ")}`);

let courses;
try {
  courses = JSON.parse(readFileSync(new URL("./legacy-catalogue.json", import.meta.url), "utf8")).courses;
} catch {
  fail("scripts/legacy-catalogue.json not found. The catalogue has already been imported and the snapshot removed; manage courses in the teacher dashboard.");
}

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()
  .replace(/^"|"$/g, "")
  .replace(/\\n/g, "\n");
const missing = [
  !projectId && "FIREBASE_ADMIN_PROJECT_ID",
  !clientEmail && "FIREBASE_ADMIN_CLIENT_EMAIL",
  !privateKey && "FIREBASE_ADMIN_PRIVATE_KEY",
].filter(Boolean);
if (missing.length) fail(`Missing environment variables: ${missing.join(", ")}`);

const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);

let teacherUid = null;
if (teacherEmail) {
  try {
    const teacher = await getAuth(app).getUserByEmail(teacherEmail);
    if (!["teacher", "admin"].includes(teacher.customClaims?.role)) {
      fail(`${teacherEmail} is not a teacher. Run: npm run set-role -- ${teacherEmail} teacher`);
    }
    teacherUid = teacher.uid;
  } catch (error) {
    if (error?.code === "auth/user-not-found") fail(`No account found for ${teacherEmail}.`);
    throw error;
  }
}

/** Catalogue fields shown on the public pages, mapped from the legacy record. */
function catalogFields(course) {
  return {
    subtitle: course.subtitle ?? "",
    subtitleMl: "",
    level: course.level ?? null,
    category: course.category ?? null,
    format: course.format ?? null,
    duration: course.duration ?? "",
    ageGroup: course.ageGroup ?? "",
    instructor: course.instructor ?? "",
    price: Number.isInteger(course.price) ? course.price : null,
    originalPrice: Number.isInteger(course.originalPrice) ? course.originalPrice : null,
    tag: course.tag ?? null,
    featured: course.featured === true,
    outcomes: Array.isArray(course.outcomes) ? course.outcomes : [],
    outcomesMl: [],
  };
}

/**
 * The old sample ratings and student counts are kept for the record but are
 * NOT shown on the site (they were placeholders, not real reviews).
 */
function legacyFields(course) {
  return { rating: course.rating ?? null, reviewCount: course.reviewCount ?? null, studentCount: course.studentCount ?? null };
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const existing = await db.getAll(...courses.map((c) => db.collection("courses").doc(c.slug)));
const existingById = new Map(existing.filter((s) => s.exists).map((s) => [s.id, s]));

const totals = { created: 0, modules: 0, lessons: 0, backfilled: 0, assigned: 0 };

for (const course of courses) {
  if (!ID_PATTERN.test(course.slug)) fail(`Slug "${course.slug}" cannot be used as a document id.`);
  const courseRef = db.collection("courses").doc(course.slug);
  const snapshot = existingById.get(course.slug);

  if (!snapshot) {
    const batch = db.batch();
    batch.create(courseRef, {
      id: course.slug,
      slug: course.slug,
      title: course.title,
      titleMl: "",
      description: course.description,
      descriptionMl: "",
      thumbnailUrl: course.image ?? null,
      thumbnailPublicId: null,
      ...catalogFields(course),
      legacy: legacyFields(course),
      status,
      teacherIds: teacherUid ? [teacherUid] : [],
      migratedFrom: "static-catalogue",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    course.curriculum.forEach((module, moduleIndex) => {
      const moduleId = `${course.slug}--m${moduleIndex + 1}`;
      batch.create(db.collection("modules").doc(moduleId), {
        id: moduleId,
        courseId: course.slug,
        title: module.title,
        titleMl: "",
        description: "",
        descriptionMl: "",
        order: moduleIndex,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      totals.modules += 1;
      module.lessons.forEach((lessonTitle, lessonIndex) => {
        const lessonId = `${moduleId}--l${lessonIndex + 1}`;
        batch.create(db.collection("lessons").doc(lessonId), {
          id: lessonId,
          courseId: course.slug,
          moduleId,
          title: lessonTitle,
          titleMl: "",
          description: "",
          descriptionMl: "",
          order: lessonIndex,
          resources: [],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        totals.lessons += 1;
      });
    });
    if (!dryRun) await batch.commit();
    totals.created += 1;
    console.log(`${dryRun ? "○ would create" : "✔ created"} ${course.slug} as ${status} (${course.curriculum.length} modules)`);
    continue;
  }

  // Existing course: only touch documents this script created, and only fill gaps.
  const updates = {};
  if (snapshot.get("migratedFrom")) {
    for (const [key, value] of Object.entries(catalogFields(course))) {
      if (snapshot.get(key) === undefined) updates[key] = value;
    }
    if (snapshot.get("legacy") === undefined) updates.legacy = legacyFields(course);
  }
  if (teacherUid && !(snapshot.get("teacherIds") ?? []).includes(teacherUid)) {
    updates.teacherIds = FieldValue.arrayUnion(teacherUid);
    totals.assigned += 1;
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    console.log(`• ${course.slug}: already up to date — left unchanged`);
    continue;
  }
  if (!dryRun) await courseRef.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  if (keys.some((k) => k !== "teacherIds")) totals.backfilled += 1;
  console.log(`${dryRun ? "○ would update" : "✔ updated"} ${course.slug}: ${keys.join(", ")}`);
}

console.log(
  `\n${dryRun ? "Dry run — nothing written. " : ""}Courses created: ${totals.created} ` +
    `(modules ${totals.modules}, lessons ${totals.lessons}), missing fields filled: ${totals.backfilled}, ` +
    `teacher assignments: ${totals.assigned}.\n`,
);
if (!dryRun && totals.created + totals.backfilled > 0) {
  console.log("The website caches the catalogue for up to an hour; editing any course in the teacher dashboard refreshes it immediately.\n");
}
process.exit(0);
