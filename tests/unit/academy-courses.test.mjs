// Unit tests for Course Management rules: grouping, the "Choose a course"
// batch options, course deletion and the Delete batch rules.
// Pure / static: no Firebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  batchDeletionPlan,
  courseDeletionPlan,
  courseGroup,
  courseOptionsFrom,
  groupManagedCourses,
  isBatchEligible,
  ownedAssets,
} from "../../src/lib/lms/academy-courses.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const c = (id, overrides = {}) => ({ id, slug: id, title: id, status: "published", programme: null, ...overrides });
const NO_USAGE = { enrollments: 0, batches: 0, registrations: 0, billingAccounts: 0, payments: 0, packages: 0, submissions: 0, reviews: 0 };

describe("Course Management lists every course record", () => {
  test("no course slug is special: regular courses and programmes only", () => {
    const bhajan = c("bhajan-workshop", { programme: { programmeType: "bhajan" } });
    const g = groupManagedCourses([c("x7Gk2"), bhajan, c("swara-foundation")]);
    assert.deepEqual(g.regular.map((x) => x.id), ["x7Gk2", "swara-foundation"]);
    assert.deepEqual(g.programme.map((x) => x.id), ["bhajan-workshop"]);
    assert.equal(courseGroup(bhajan), "programme");
    assert.equal(courseGroup(c("anything")), "regular");
  });

  test("the courses page shows the empty state and never refers to a hardcoded catalogue", () => {
    const page = read("src/app/(account)/teacher/courses/page.tsx");
    assert.match(page, /No courses have been added yet\./);
    assert.match(page, /<CreateCourseDialog label="Add course" \/>/);
    assert.doesNotMatch(page, /approved|missingMain|Swara Foundation|Little Swaras/);
    // A failed read shows the classified cause instead of a generic crash.
    assert.match(page, /logReadFailure\("teacher\.courses", error\)/);
  });
});

describe("Manage Batches → Choose a course", () => {
  test("any non-draft regular course is offered (by title); drafts and programmes are not", () => {
    const options = courseOptionsFrom([
      c("z1", { title: "Voice Basics" }),
      c("a1", { title: "Bhajans", programme: { programmeType: "bhajan" } }),
      c("d1", { title: "Draft course", status: "draft" }),
      c("k1", { title: "Kids Beginners", status: "archived" }),
    ]);
    assert.deepEqual(options, [
      { id: "k1", title: "Kids Beginners" },
      { id: "z1", title: "Voice Basics" },
    ]);
    assert.equal(isBatchEligible(c("new-course-abc")), true);
    assert.equal(isBatchEligible(c("new-course-abc", { status: "draft" })), false);
  });

  test("createBatch enforces eligibility on the server", () => {
    const actions = read("src/app/(account)/teacher/batch-actions.ts");
    assert.match(actions, /if \(!isBatchEligible\(course\)\)/);
  });
});

describe("Delete course", () => {
  test("only a course nobody used can be deleted; any history blocks with the reason", () => {
    assert.deepEqual(courseDeletionPlan(NO_USAGE), { kind: "delete" });
    const blocked = courseDeletionPlan({ ...NO_USAGE, enrollments: 1, payments: 3 });
    assert.equal(blocked.kind, "blocked");
    assert.match(blocked.reason, /1 student enrolment\b/);
    assert.match(blocked.reason, /3 payment records/);
    assert.match(blocked.reason, /Archive it instead/);
    for (const key of Object.keys(NO_USAGE)) assert.equal(courseDeletionPlan({ ...NO_USAGE, [key]: 1 }).kind, "blocked", key);
  });

  test("only assets inside the course's own folder are deleted, each once", () => {
    const folder = "swaranjanam/courses/c1";
    const owned = ownedAssets(folder, [
      { publicId: "swaranjanam/courses/c1/thumbnails/a", resourceType: "image" },
      { publicId: "swaranjanam/courses/c1/resources/b.docx", resourceType: "raw" },
      { publicId: "swaranjanam/courses/c1/resources/b.docx", resourceType: "raw" },
      { publicId: "swaranjanam/courses/c10/resources/x", resourceType: "video" },
      { publicId: "swaranjanam/courses/other/resources/y", resourceType: "video" },
      { publicId: null, resourceType: "image" },
      { publicId: "swaranjanam/courses/c1/resources/z", resourceType: null },
    ]);
    assert.deepEqual(owned, [
      { publicId: "swaranjanam/courses/c1/thumbnails/a", resourceType: "image" },
      { publicId: "swaranjanam/courses/c1/resources/b.docx", resourceType: "raw" },
    ]);
  });

  test("the server action is teacher-only, confirms the title, checks usage, deletes Firestore first and audits", () => {
    const actions = read("src/app/(account)/teacher/actions.ts");
    const body = actions.slice(actions.indexOf("export async function deleteCourse"), actions.indexOf("// --- Modules"));
    assert.match(body, /authorizeTeacherForCourse\(courseId\)/);
    assert.match(body, /Type the course title exactly to confirm/);
    assert.match(body, /courseDeletionPlan\(await courseUsage\(course\.id\)\)/);
    assert.match(body, /if \(plan\.kind === "blocked"\) throw new AccessError\(plan\.reason\)/);
    assert.match(body, /writeAudit/);
    assert.ok(body.indexOf('col("courses").doc(course.id).delete()') < body.indexOf("deleteAsset("), "files are removed only after the records");
    for (const name of ["enrollments", "batches", "registrations", "billingAccounts", "payments", "packages", "submissions", "reviews"]) assert.match(actions, new RegExp(`"${name}"`));
  });
});

describe("Delete batch", () => {
  test("learners must be removed first; any history archives; only an unused batch is deleted", () => {
    assert.equal(batchDeletionPlan({ activeMembers: 2, historyRecords: 5 }).kind, "blocked");
    assert.match(batchDeletionPlan({ activeMembers: 1, historyRecords: 1 }).reason, /1 learner\b/);
    assert.equal(batchDeletionPlan({ activeMembers: 0, historyRecords: 1 }).kind, "archive");
    assert.equal(batchDeletionPlan({ activeMembers: 0, historyRecords: 0 }).kind, "delete");
  });

  test("server action checks the teacher role and deletes nothing but the batch document", () => {
    const actions = read("src/app/(account)/teacher/batch-actions.ts");
    const body = actions.slice(actions.indexOf("export async function deleteBatch"), actions.indexOf("/** Edits a batch."));
    assert.match(body, /requireActionUser\("teacher"\)/);
    assert.equal((body.match(/tx\.delete\(/g) ?? []).length, 1);
    assert.match(body, /tx\.delete\(ref\)/);
    assert.match(body, /status: "archived"/);
    assert.match(body, /writeAudit/);
    const usage = read("src/lib/lms/server/batches.ts");
    for (const name of ["liveClasses", "billableClasses", "billingAccounts", "invoices", "registrations", "payments", "batchMembers"]) assert.match(usage, new RegExp(`"${name}"`));
  });

  test("confirmation names the batch and its learner count", () => {
    const ui = read("src/components/lms/teacher/batch-controls.tsx");
    assert.match(ui, /title=\{`Delete batch "\$\{name\}"\?`\}/);
    assert.match(ui, /\$\{memberCount\} learner/);
  });
});
