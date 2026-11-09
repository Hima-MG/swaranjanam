// Unit tests for pricing managed only inside each course (Course management →
// course → Pricing): Learn Together rates per course, display = server price,
// and the retired Fees & pricing page. Pure / static: no Firebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { publicFeesFromPricing } from "../../src/lib/catalog/public-pricing.ts";
import { effectiveCoursePricing, parseCoursePricing } from "../../src/lib/lms/course-pricing.ts";
import { enrolmentChoices } from "../../src/lib/lms/enrolment-options.ts";
import { enrolmentRates } from "../../src/lib/lms/registration.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const CONFIRMED = { batchMinor: 40_000, individualMinor: 75_000 };

describe("all four class prices are set per course", () => {
  test("defaults: ₹400 batch, ₹750 one-to-one, Learn Together ₹360 / ₹700 per person", () => {
    const p = effectiveCoursePricing(null, CONFIRMED);
    assert.deepEqual([p.batchMinor, p.individualMinor, p.sharedBatchMinor, p.sharedIndividualMinor], [40_000, 75_000, 36_000, 70_000]);
    // Saved before shared rates were per course: unchanged academy shared rates.
    const old = effectiveCoursePricing({ batchEnabled: true, batchMinor: 40_000, individualEnabled: true, individualMinor: 75_000 }, CONFIRMED);
    assert.deepEqual([old.sharedBatchMinor, old.sharedIndividualMinor], [36_000, 70_000]);
  });

  test("a course's own Learn Together prices are saved and validated", () => {
    const v = parseCoursePricing({ batchEnabled: "on", batchPrice: "400", individualEnabled: "on", individualPrice: "750", sharedBatchPrice: "380", sharedIndividualPrice: "720" }).value;
    assert.deepEqual([v.sharedBatchMinor, v.sharedIndividualMinor], [38_000, 72_000]);
    assert.ok(parseCoursePricing({ batchEnabled: "on", batchPrice: "400", sharedBatchPrice: "-5" }).errors.sharedBatchPrice);
    const batchOnly = parseCoursePricing({ batchEnabled: "on", batchPrice: "400", sharedIndividualPrice: "700" }).value;
    assert.equal(batchOnly.sharedIndividualMinor, null);
    // Stored values survive a reload.
    const reloaded = effectiveCoursePricing(v, CONFIRMED);
    assert.deepEqual([reloaded.sharedBatchMinor, reloaded.sharedIndividualMinor], [38_000, 72_000]);
  });

  test("public fees and enrolment choices show the course's saved prices; the server uses the same rate", () => {
    const pricing = effectiveCoursePricing({ batchEnabled: true, batchMinor: 45_000, individualEnabled: true, individualMinor: 80_000, sharedBatchMinor: 38_000, sharedIndividualMinor: 72_000 }, CONFIRMED);
    const fee = publicFeesFromPricing(pricing);
    assert.deepEqual([fee.batchMinor, fee.individualMinor, fee.sharedBatchMinor, fee.sharedIndividualMinor], [45_000, 80_000, 38_000, 72_000]);
    const shared = enrolmentChoices(fee).find((c) => c.type === "shared_batch");
    assert.match(shared.rate, /380/);
    assert.deepEqual(enrolmentRates("shared_batch", fee.batchMinor, fee.sharedBatchMinor), { perLearnerMinor: 38_000, learnerCount: 2, sessionMinor: 76_000 });
    assert.match(read("src/lib/lms/server/registrations.ts"), /enrolmentRates\(enrolmentType, courseRate, sharedRate\)/);
  });

  test("special programmes: one full fee, no monthly billing", () => {
    assert.match(read("src/components/lms/teacher/programme-form.tsx"), /paid in full at enrolment\. No monthly billing\./);
  });
});

describe("the separate Fees & pricing page is retired", () => {
  test("not in the teacher navigation; the old route redirects to Course management", () => {
    assert.doesNotMatch(read("src/components/lms/teacher/teacher-nav.tsx"), /\/teacher\/pricing|Fees & pricing/);
    const page = read("src/app/(account)/teacher/pricing/page.tsx");
    assert.match(page, /redirect\("\/teacher\/courses"\)/);
    assert.doesNotMatch(page, /PlanEditDialog|InstallPlansButton/);
  });

  test("accepted payment methods are still managed (Rates & policy)", () => {
    assert.match(read("src/app/(account)/teacher/billing/settings/page.tsx"), /<PaymentMethodsForm /);
  });

  test("no public page uses a hard-coded Learn Together rate", () => {
    for (const f of ["src/components/course/course-fees.tsx", "src/app/(public)/courses/[slug]/page.tsx"]) assert.doesNotMatch(read(f), /SHARED_RATES/, f);
  });
});
