// Unit tests for public course fees (src/lib/catalog/public-fees.ts).
// Pure tests against the published plan definitions in src/lib/lms/billing.ts.
// They do not read Firestore: the live plans and their course links must be
// checked on the Fees & pricing page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { feeHeadline, planForCourse, publicFeeFromPlan } from "../../src/lib/catalog/public-fees.ts";
import { PUBLISHED_PLANS, snapshotPlan } from "../../src/lib/lms/billing.ts";

const plan = (id, overrides = {}) => ({ ...snapshotPlan(PUBLISHED_PLANS.find((p) => p.id === id)), ...overrides });

describe("public fee from a published plan", () => {
  for (const [id, adult, student] of [
    ["swara-foundation", 160_000, 150_000],
    ["devotional-music", 160_000, 150_000],
    ["personal-coaching", 320_000, 300_000],
  ]) {
    test(`${id}: adult and student fees exactly as published`, () => {
      const fee = publicFeeFromPlan(plan(id));
      assert.equal(fee.adultPriceMinor, adult);
      assert.equal(fee.studentPriceMinor, student);
      assert.equal(fee.sessionsIncluded, 4);
      assert.equal(fee.status, "active");
    });
  }

  test("Little Swaras: student fee only; no adult fee is invented", () => {
    const fee = publicFeeFromPlan(plan("little-swaras"));
    assert.equal(fee.adultPriceMinor, null);
    assert.equal(fee.studentPriceMinor, 150_000);
    assert.deepEqual(feeHeadline(fee), { amountMinor: 150_000, from: false, unit: "per 4 classes" });
  });

  test("pair fees are the published figures, for eligible courses only", () => {
    for (const id of ["swara-foundation", "little-swaras", "devotional-music"]) {
      assert.deepEqual(publicFeeFromPlan(plan(id)).pairPricesMinor, { two_adults: 288_000, adult_student: 279_000, two_students: 270_000 }, id);
    }
    for (const id of ["geetha-pathway", "kriti-varnam-pathway", "personal-coaching", "voice-culture"]) {
      assert.equal(publicFeeFromPlan(plan(id)).pairPricesMinor, null, id);
    }
  });

  test("coming-soon courses keep their status and published fees", () => {
    const geetha = publicFeeFromPlan(plan("geetha-pathway"));
    assert.equal(geetha.status, "coming_soon");
    assert.equal(geetha.adultPriceMinor, 200_000);
    assert.equal(geetha.studentPriceMinor, 190_000);
    const kriti = publicFeeFromPlan(plan("kriti-varnam-pathway"));
    assert.equal(kriti.status, "coming_soon");
    assert.equal(kriti.adultPriceMinor, 250_000);
    assert.equal(kriti.studentPriceMinor, 240_000);
  });

  test("Voice Culture: ₹2,499 one-time, six weeks", () => {
    const fee = publicFeeFromPlan(plan("voice-culture"));
    assert.equal(fee.kind, "program");
    assert.equal(fee.flatPriceMinor, 249_900);
    assert.equal(fee.durationWeeks, 6);
    assert.equal(fee.adultPriceMinor, null);
    assert.deepEqual(feeHeadline(fee), { amountMinor: 249_900, from: false, unit: "one-time" });
  });

  test("headline is 'From' the lower individual fee per package", () => {
    assert.deepEqual(feeHeadline(publicFeeFromPlan(plan("swara-foundation"))), { amountMinor: 150_000, from: true, unit: "per 4 classes" });
  });

  test("inactive or unconfigured plans publish nothing ('Fees on request')", () => {
    assert.equal(publicFeeFromPlan(plan("swara-foundation", { status: "inactive" })), null);
    assert.equal(publicFeeFromPlan(plan("swara-foundation", { adultPriceMinor: null, studentPriceMinor: null })), null);
    assert.equal(publicFeeFromPlan(plan("voice-culture", { flatPriceMinor: null })), null);
    assert.equal(publicFeeFromPlan(plan("swara-foundation", { sessionsIncluded: 0 })), null);
    assert.equal(publicFeeFromPlan(null), null);
  });

  test("the public fee carries no discount, history or staff data", () => {
    const fee = publicFeeFromPlan({ ...plan("swara-foundation"), history: [{ byEmail: "teacher@example.com" }], updatedByEmail: "teacher@example.com" });
    const json = JSON.stringify(fee);
    assert.equal(json.includes("teacher@example.com"), false);
    assert.equal(/discount|original/i.test(json), false);
  });
});

describe("linking plans to courses", () => {
  const plans = [
    plan("swara-foundation", { courseId: "course-a" }),
    plan("little-swaras", { courseId: "course-b" }),
    plan("devotional-music", { courseId: "course-b", order: 9 }),
    plan("geetha-pathway", { courseId: "course-c", status: "inactive" }),
  ];

  test("the plan linked by courseId is used", () => {
    assert.equal(planForCourse(plans, "course-a").id, "swara-foundation");
  });
  test("no linked plan → null (no fallback to the legacy course price)", () => {
    assert.equal(planForCourse(plans, "course-z"), null);
    assert.equal(planForCourse(PUBLISHED_PLANS, "swara-foundation"), null); // plan ids are not course ids
  });
  test("an inactive linked plan is ignored", () => {
    assert.equal(planForCourse(plans, "course-c"), null);
  });
  test("several linked plans: the lowest order wins, deterministically", () => {
    assert.equal(planForCourse(plans, "course-b").id, "little-swaras");
  });
});

describe("public pages never read the legacy course price", () => {
  for (const file of ["src/components/course/course-card.tsx", "src/app/(public)/courses/[slug]/page.tsx", "src/components/course/course-price.tsx", "src/lib/catalog/server.ts"]) {
    test(file, () => {
      // Code only: comments may explain why the legacy field is not used.
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert.equal(/course\.price\b|originalPrice|% off/.test(source), false);
    });
  }
});
