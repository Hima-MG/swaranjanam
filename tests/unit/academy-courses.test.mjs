// Unit tests for Course Management grouping, the "Choose a course" batch
// options, safe creation of the main courses and the Delete batch rules.
// Pure / static: no Firebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { APPROVED_COURSES } from "../../src/data/approved-courses.ts";
import { fromApproved, fromFirestore } from "../../src/lib/catalog/public-catalog.ts";
import { publicFeesFromRate } from "../../src/lib/catalog/public-pricing.ts";
import {
  batchDeletionPlan,
  courseGroup,
  courseOptionsFrom,
  groupManagedCourses,
  isBatchEligible,
  mainCourseFields,
  planMainCourseCreation,
} from "../../src/lib/lms/academy-courses.ts";
import { DEFAULT_RATE_VERSION } from "../../src/lib/lms/class-billing.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const c = (id, overrides = {}) => ({ id, slug: id, title: id, status: "published", programme: null, ...overrides });

// What production holds today: legacy syllabus topics and programmes, no main courses.
const LEGACY = ["sarali-varisai", "janta-varisai", "alankaram", "geetham", "bhajan-devotional-singing", "short-workshops", "basics-for-beginners"].map((id) => c(id));

describe("Course Management lists academy-level courses", () => {
  test("syllabus topics are never grouped as main courses; missing main courses are reported", () => {
    const g = groupManagedCourses(LEGACY);
    assert.equal(g.main.length, 0);
    assert.equal(g.other.length, LEGACY.length);
    assert.deepEqual(g.missingMain.map((a) => a.slug), ["swara-foundation", "little-swaras"]);
  });

  test("main courses come first in fixed order, programmes separately", () => {
    const bhajan = c("bhajan-workshop", { programme: { programmeType: "bhajan" } });
    const g = groupManagedCourses([...LEGACY, c("little-swaras"), bhajan, c("swara-foundation", { status: "draft" })]);
    assert.deepEqual(g.main.map((x) => x.id), ["swara-foundation", "little-swaras"]);
    assert.deepEqual(g.programme.map((x) => x.id), ["bhajan-workshop"]);
    assert.equal(g.missingMain.length, 0);
    assert.equal(courseGroup(bhajan), "programme");
  });

  test("a main course stored under another id but with the main slug still counts", () => {
    assert.equal(courseGroup(c("abc123", { slug: "swara-foundation" })), "main");
  });
});

describe("Manage Batches → Choose a course", () => {
  test("only non-draft main courses are offered; syllabus topics and programmes are not", () => {
    const options = courseOptionsFrom([
      ...LEGACY,
      c("bhajan-workshop", { programme: { programmeType: "bhajan" } }),
      c("little-swaras", { title: "Little Swaras (Kids)" }),
      c("swara-foundation", { title: "Swara Foundation (Adults)" }),
    ]);
    assert.deepEqual(options, [
      { id: "swara-foundation", title: "Swara Foundation (Adults)" },
      { id: "little-swaras", title: "Little Swaras (Kids)" },
    ]);
    assert.equal(isBatchEligible(c("swara-foundation", { status: "draft" })), false);
  });

  test("createBatch enforces eligibility on the server", () => {
    const actions = read("src/app/(account)/teacher/batch-actions.ts");
    assert.match(actions, /if \(!isBatchEligible\(course\)\)/);
  });
});

describe("creating the missing main courses", () => {
  test("idempotent: nothing is created when a record already uses the slug, id or title", () => {
    assert.deepEqual(planMainCourseCreation(LEGACY).create.map((a) => a.slug), ["swara-foundation", "little-swaras"]);
    const again = planMainCourseCreation([...LEGACY, { id: "swara-foundation" }, { id: "x9", slug: null, title: "little swaras (kids)" }]);
    assert.equal(again.create.length, 0);
    assert.equal(again.skip.length, 2);
    assert.equal(planMainCourseCreation([{ id: "other", slug: "little-swaras" }]).create.length, 1);
  });

  test("uses only approved details, stores no pricing and leaves the public listing unchanged", () => {
    const fees = publicFeesFromRate(DEFAULT_RATE_VERSION);
    for (const approved of APPROVED_COURSES.filter((a) => ["swara-foundation", "little-swaras"].includes(a.slug))) {
      const fields = mainCourseFields(approved);
      assert.equal(fields.price, null);
      assert.equal("pricing" in fields, false);
      assert.equal("programme" in fields, false);
      const record = { ...fields, storedPricing: null, programme: null, scheduleInfo: null, createdAt: null, updatedAt: null };
      const before = fromApproved(approved, fees);
      const after = fromFirestore({ record, moduleCount: 0, lessonCount: 0 }, fees);
      for (const key of ["slug", "title", "subtitle", "description", "availability", "fee", "level", "category", "ageGroup", "outcomes", "featured"]) {
        assert.deepEqual(after[key], before[key], key);
      }
    }
  });

  test("the script defaults to the emulator and needs --production --apply to write elsewhere", () => {
    const script = read("scripts/create-main-courses.mjs");
    assert.match(script, /FIRESTORE_EMULATOR_HOST = "127\.0\.0\.1:8080"/);
    assert.match(script, /const write = production \? apply : true;/);
    assert.match(script, /\.create\(/);
    assert.doesNotMatch(script, /\.set\(|\.delete\(|\.update\(/);
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
