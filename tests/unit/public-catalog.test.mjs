// Unit tests for the public "Courses & fees" catalogue: fees derived from the
// billing rates in force, the approved-catalogue fallback, availability rules,
// and that nothing private reaches the public site. Pure / static: no Firebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { APPROVED_COURSES } from "../../src/data/approved-courses.ts";
import { buildPublicCatalog } from "../../src/lib/catalog/public-catalog.ts";
import { discounted, FEE_TERMS, publicFeesFromRate, SIBLING_DISCOUNT_PERCENT } from "../../src/lib/catalog/public-pricing.ts";
import { DEFAULT_RATE_VERSION } from "../../src/lib/lms/class-billing.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const FEES = publicFeesFromRate(DEFAULT_RATE_VERSION);

function record(overrides = {}) {
  return {
    id: "c1", slug: "c1", title: "Course", titleMl: "", description: "Description", descriptionMl: "",
    thumbnailUrl: null, thumbnailPublicId: null, status: "published", teacherIds: ["teacher-uid"], createdAt: null, updatedAt: null,
    subtitle: "", subtitleMl: "", level: null, category: null, format: null, duration: "12 weeks", ageGroup: "", instructor: "",
    price: 4999, originalPrice: 6499, tag: null, featured: false, outcomes: [], outcomesMl: [], availability: "open",
    ...overrides,
  };
}
const entry = (overrides) => ({ record: record(overrides), moduleCount: 1, lessonCount: 3 });

describe("public fees come from the billing rates in force", () => {
  test("confirmed fees: batch ₹400, individual ₹750, siblings ₹360 per learner (10% off)", () => {
    assert.deepEqual(FEES, { batchMinor: 40_000, individualMinor: 75_000, siblingBatchMinor: 36_000, siblingDiscountPercent: 10 });
    assert.equal(SIBLING_DISCOUNT_PERCENT, 10);
  });
  test("a new rate version flows through (no amounts are hard-coded in the UI)", () => {
    const fees = publicFeesFromRate({ batchMinor: 45_000, individualMinor: 80_000 });
    assert.equal(fees.batchMinor, 45_000);
    assert.equal(fees.individualMinor, 80_000);
    assert.equal(fees.siblingBatchMinor, 40_500);
  });
  test("the sibling discount is rounded to whole rupees", () => {
    assert.equal(discounted(40_000, 10), 36_000);
    assert.equal(discounted(41_500, 10), 37_400); // ₹373.50 → ₹374
  });
  test("payment terms are per session, monthly, no registration fee, no fixed duration — and no unconfirmed policy", () => {
    const text = FEE_TERMS.join(" ");
    for (const phrase of [/per session/, /end of each month/, /one week to pay/, /No registration fee/, /no fixed course duration/]) assert.match(text, phrase);
    // Refunds, academy cancellations, rescheduling and leaving are still "suggested" in the workbook.
    assert.doesNotMatch(text, /refund|reschedul|cancel|leave|leaving/i);
    assert.doesNotMatch(text, /upfront|package|bundle|4 classes|four classes/i);
  });
});

describe("approved catalogue (course details workbook)", () => {
  test("Swara Foundation and Little Swaras are open; the four others are coming soon", () => {
    const status = Object.fromEntries(APPROVED_COURSES.map((c) => [c.slug, c.availability]));
    assert.deepEqual(status, {
      "swara-foundation": "open",
      "little-swaras": "open",
      "devotional-songs": "coming_soon",
      "voice-culture": "coming_soon",
      "intermediate-level": "coming_soon",
      "advanced-level": "coming_soon",
    });
  });
  test("no fees, durations or unconfirmed details are stored in the approved catalogue", () => {
    const src = read("src/data/approved-courses.ts").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(src, /₹\s?\d|price|weeks|months|suggested|5–15/i);
  });
});

describe("buildPublicCatalog", () => {
  const build = (firestore = [], knownSlugs = new Set(firestore.map((e) => e.record.slug))) =>
    buildPublicCatalog({ firestore, knownSlugs, approved: APPROVED_COURSES, fees: FEES });

  test("empty database: the approved catalogue is shown, open courses first with the current fees", () => {
    const list = build();
    assert.deepEqual(list.map((c) => c.slug), ["swara-foundation", "little-swaras", "devotional-songs", "voice-culture", "intermediate-level", "advanced-level"]);
    for (const c of list) {
      assert.equal(c.source, "approved");
      if (c.availability === "open") assert.deepEqual(c.fee, FEES);
      else assert.equal(c.fee, null, `${c.slug}: coming soon → fees to be announced`);
      assert.equal(c.duration, "", "no fixed duration advertised");
    }
  });

  test("a teacher's published course with the same slug replaces the approved entry (never duplicated)", () => {
    const list = build([entry({ id: "abc", slug: "swara-foundation", title: "Swara Foundation (from Firestore)" })]);
    const matches = list.filter((c) => c.slug === "swara-foundation");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].source, "firestore");
    assert.equal(matches[0].title, "Swara Foundation (from Firestore)");
    assert.equal(new Set(list.map((c) => c.slug)).size, list.length);
  });

  test("a draft or unpublished course with an approved slug hides that course (teacher decides)", () => {
    const list = build([], new Set(["little-swaras"]));
    assert.equal(list.some((c) => c.slug === "little-swaras"), false);
    const listDraft = build([entry({ slug: "little-swaras", status: "draft" })]);
    assert.equal(listDraft.some((c) => c.slug === "little-swaras"), false);
  });

  test("a published course without an availability setting (unreviewed template content) is not listed", () => {
    const list = build([entry({ slug: "basics-for-beginners", availability: null, tag: "Bestseller" })]);
    assert.equal(list.some((c) => c.slug === "basics-for-beginners"), false);
  });

  test("teacher-set availability decides fees: coming soon shows no fee, open shows the current rates", () => {
    const list = build([entry({ slug: "new-course", availability: "coming_soon" }), entry({ id: "c2", slug: "open-course", availability: "open" })]);
    assert.equal(list.find((c) => c.slug === "new-course").fee, null);
    assert.deepEqual(list.find((c) => c.slug === "open-course").fee, FEES);
  });

  test("nothing private or legacy reaches the public course object", () => {
    const [course] = build([entry({ slug: "open-course" })]).filter((c) => c.slug === "open-course");
    for (const key of ["price", "originalPrice", "teacherIds", "agreedFee", "status", "thumbnailPublicId"]) {
      assert.equal(key in course, false, key);
    }
    assert.doesNotMatch(JSON.stringify(course), /4999|6499|teacher-uid/);
  });
});

describe("one consolidated public courses + fees section", () => {
  test("the homepage renders the courses & fees section once, plus the FAQ", () => {
    const home = read("src/app/(public)/page.tsx");
    assert.equal(home.match(/<CoursesSection \/>/g)?.length, 1);
    assert.match(home, /<FaqSection \/>/);
    assert.doesNotMatch(home, /FeaturedCourses|Featured courses/);
  });
  test("there is no separate public courses listing or pricing page; /courses redirects to the section", () => {
    assert.throws(() => read("src/app/(public)/courses/page.tsx"));
    assert.throws(() => read("src/app/(public)/pricing/page.tsx"));
    assert.match(read("next.config.ts"), /source: "\/courses", destination: "\/#courses"/);
  });
  test("navigation and footer point to the section", () => {
    const site = read("src/config/site.ts");
    assert.match(site, /\{ label: "Courses & Fees", href: "\/#courses" \}/);
    assert.doesNotMatch(site, /href: "\/courses"/);
  });
  test("no 'Fees on request', free-trial or legacy package wording remains on public pages", () => {
    const files = [
      "src/app/(public)/page.tsx", "src/app/(public)/courses/[slug]/page.tsx", "src/app/(public)/contact/page.tsx", "src/app/(public)/about/page.tsx",
      "src/components/home/hero.tsx", "src/components/home/courses-and-fees.tsx", "src/components/shared/cta-banner.tsx",
      "src/components/course/course-card.tsx", "src/components/course/course-fees.tsx", "src/data/content.ts", "src/data/faq.ts",
    ];
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /Fees on request/i, f);
      assert.doesNotMatch(src, /free trial|free introductory/i, f);
      assert.doesNotMatch(src, /Package of|paid in advance|per 4 class|4 classes/i, f);
    }
  });
  test("the public fee code never reads student-specific or legacy fee fields", () => {
    for (const f of ["src/lib/catalog/server.ts", "src/lib/catalog/public-catalog.ts", "src/components/course/course-fees.tsx", "src/components/home/courses-and-fees.tsx"]) {
      const code = read(f).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(code, /agreedFee|\.price\b|originalPrice|pricePlans|listPlans|enrollments|payments/, f);
    }
  });
});
