// Unit tests for the public "Courses & fees" catalogue: fees derived from the
// billing rates in force, Firestore-only courses (no hardcoded fallback),
// availability rules, and that nothing private reaches the public site.
// Pure / static: no Firebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { buildPublicCatalog, publicAvailability } from "../../src/lib/catalog/public-catalog.ts";
import { discounted, FEE_TERMS, publicFeesFromRate, SIBLING_DISCOUNT_ENABLED, SIBLING_DISCOUNT_PERCENT } from "../../src/lib/catalog/public-pricing.ts";
import { DEFAULT_RATE_VERSION } from "../../src/lib/lms/class-billing.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const FEES = publicFeesFromRate(DEFAULT_RATE_VERSION);

function record(overrides = {}) {
  return {
    id: "c1", slug: "c1", title: "Course", titleMl: "", description: "Description", descriptionMl: "",
    thumbnailUrl: null, thumbnailPublicId: null, coverUrl: null, coverPublicId: null, importedTemplate: false, hiddenFromPublic: false, status: "published", teacherIds: ["teacher-uid"], createdAt: null, updatedAt: null,
    subtitle: "", subtitleMl: "", level: null, category: null, format: null, duration: "12 weeks", ageGroup: "", instructor: "",
    price: 4999, originalPrice: 6499, tag: null, featured: false, outcomes: [], outcomesMl: [], availability: "open",
    ...overrides,
  };
}
const entry = (overrides) => ({ record: record(overrides), moduleCount: 1, lessonCount: 3 });

describe("public fees come from the billing rates in force", () => {
  test("confirmed fees: batch ₹400, individual ₹750, ₹400 enrolment advance; sibling discount OFF until billing applies it", () => {
    assert.deepEqual(FEES, { batchMinor: 40_000, individualMinor: 75_000, sharedBatchMinor: 36_000, sharedIndividualMinor: 70_000, batchAdvanceMinor: 40_000, siblingDiscount: null });
    assert.equal(SIBLING_DISCOUNT_ENABLED, false);
    assert.equal(SIBLING_DISCOUNT_PERCENT, 10);
  });
  test("a new rate version flows through (no amounts are hard-coded in the UI)", () => {
    const fees = publicFeesFromRate({ batchMinor: 45_000, individualMinor: 80_000, batchAdvanceMinor: 50_000 });
    assert.equal(fees.batchMinor, 45_000);
    assert.equal(fees.individualMinor, 80_000);
    assert.equal(fees.batchAdvanceMinor, 50_000);
    assert.equal(fees.siblingDiscount, null);
    // Only when billing supports it would the discounted amount appear.
    assert.deepEqual(publicFeesFromRate({ batchMinor: 45_000, individualMinor: 80_000, batchAdvanceMinor: 50_000 }, true).siblingDiscount, { percent: 10, batchMinor: 40_500 });
  });
  test("the sibling discount is rounded to whole rupees", () => {
    assert.equal(discounted(40_000, 10), 36_000);
    assert.equal(discounted(41_500, 10), 37_400); // ₹373.50 → ₹374
  });
  test("payment terms are per session, first class at enrolment (deducted once), calendar-month invoices due in 3 days, no registration fee, no fixed duration — and no unconfirmed policy", () => {
    const text = FEE_TERMS.join(" ");
    for (const phrase of [/per session/, /first class or session is paid when you enrol/, /deducted on your first monthly invoice/, /never charged twice/, /last day of each calendar month/, /within 3 days/, /No registration fee/, /no fixed course duration/]) assert.match(text, phrase);
    // Refunds, academy cancellations, rescheduling and leaving are still "suggested" in the workbook.
    assert.doesNotMatch(text, /refund|reschedul|cancel|leave|leaving/i);
    assert.doesNotMatch(text, /upfront|package|bundle|four weeks|classes 2–4/i);
  });
});

describe("no hardcoded course catalogue", () => {
  test("the approved-catalogue fallback and the course-creation scripts are gone", () => {
    for (const f of ["src/data/approved-courses.ts", "src/data/before-first-class.ts", "scripts/create-main-courses.mjs", "scripts/migrate-courses.mjs", "scripts/legacy-catalogue.json"]) {
      assert.throws(() => read(f), f);
    }
  });
  test("public and dashboard code names no course and inserts none", () => {
    const files = [
      "src/lib/catalog/server.ts", "src/lib/catalog/public-catalog.ts", "src/lib/lms/academy-courses.ts", "src/app/(account)/teacher/courses/page.tsx",
      "src/app/(public)/courses/[slug]/page.tsx", "src/components/home/hero.tsx", "src/components/home/courses-and-fees.tsx", "src/data/content.ts", "src/data/faq.ts",
    ];
    for (const f of files) {
      const code = read(f).replace(/\/\/[^\n]*/g, "");
      assert.doesNotMatch(code, /swara-foundation|little-swaras|Swara Foundation|Little Swaras|Sarali Varisai \(|devotional-songs|voice-culture/, f);
    }
  });
});

describe("buildPublicCatalog", () => {
  const build = (firestore = []) => buildPublicCatalog({ firestore, fees: FEES });

  test("empty database: the public catalogue is empty (no sample courses)", () => {
    assert.deepEqual(build(), []);
  });

  test("published Firestore courses are listed, open first, with their fees", () => {
    const list = build([entry({ id: "b", slug: "b-course", title: "B", availability: "coming_soon" }), entry({ id: "a", slug: "a-course", title: "A" })]);
    assert.deepEqual(list.map((c) => c.slug), ["a-course", "b-course"]);
    assert.ok(list.every((c) => c.source === "firestore"));
    assert.deepEqual(list[0].fee, FEES);
    assert.equal(list[1].fee, null);
  });

  test("drafts and archived courses are never listed", () => {
    assert.equal(build([entry({ status: "draft" }), entry({ id: "c3", slug: "c3", status: "archived" })]).length, 0);
  });

  test("a published course whose enrolment status was never set is listed as open (it used to be invisible)", () => {
    const [course] = build([entry({ slug: "made-in-dashboard", availability: null })]);
    assert.equal(course?.slug, "made-in-dashboard");
    assert.equal(course.availability, "open");
    assert.deepEqual(course.fee, FEES);
  });

  test("unreviewed template imports and courses the teacher marked 'Not listed' stay hidden; drafts never show", () => {
    const list = build([
      entry({ id: "t1", slug: "basics-for-beginners", availability: null, importedTemplate: true, tag: "Bestseller" }),
      entry({ id: "t2", slug: "hidden-course", availability: null, hiddenFromPublic: true }),
      entry({ id: "t3", slug: "draft-course", availability: null, status: "draft" }),
    ]);
    assert.deepEqual(list, []);
    assert.equal(publicAvailability({ status: "published", availability: "coming_soon", hiddenFromPublic: false, importedTemplate: true }), "coming_soon");
    assert.equal(publicAvailability({ status: "archived", availability: "open", hiddenFromPublic: false, importedTemplate: false }), null);
  });

  test("publishing opens a course with no status, and 'Not listed' is saved explicitly", () => {
    const actions = read("src/app/(account)/teacher/actions.ts");
    assert.match(actions, /const opens = status === "published" && course\.availability === null && !course\.hiddenFromPublic;/);
    assert.match(actions, /hiddenFromPublic: fields\.availability === null/);
    // Every public read uses the same rule.
    const server = read("src/lib/catalog/server.ts");
    assert.equal((server.match(/publicAvailability\(/g) ?? []).length, 2);
  });

  test("teacher-set availability decides fees: coming soon shows no fee, open shows the current rates", () => {
    const list = build([entry({ slug: "new-course", availability: "coming_soon" }), entry({ id: "c2", slug: "open-course", availability: "open" })]);
    assert.equal(list.find((c) => c.slug === "new-course").fee, null);
    assert.deepEqual(list.find((c) => c.slug === "open-course").fee, FEES);
  });

  test("the cover image is public; nothing private or legacy reaches the public course object", () => {
    const [course] = build([entry({ slug: "open-course", coverUrl: "https://res.cloudinary.com/x/image/upload/c.jpg", coverPublicId: "swaranjanam/courses/c1/covers/u" })]);
    assert.equal(course.coverUrl, "https://res.cloudinary.com/x/image/upload/c.jpg");
    for (const key of ["price", "originalPrice", "teacherIds", "agreedFee", "status", "thumbnailPublicId", "coverPublicId"]) {
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

describe("website enrolment journey", () => {
  const PUBLIC = [
    "src/app/(public)/page.tsx", "src/app/(public)/courses/[slug]/page.tsx", "src/components/home/hero.tsx", "src/components/home/courses-and-fees.tsx",
    "src/components/shared/cta-banner.tsx", "src/components/course/course-card.tsx", "src/components/course/course-fees.tsx", "src/data/content.ts", "src/data/faq.ts",
  ];
  test("no 'Enrol on WhatsApp' CTA, and no sibling discount amount is advertised while billing cannot apply it", () => {
    for (const f of PUBLIC) {
      const src = read(f);
      assert.doesNotMatch(src, /Enrol on WhatsApp/, f);
      assert.doesNotMatch(src, /₹360|10% off|siblingBatchMinor/, f);
    }
  });
  test("course cards open the details page (per-session rates only, no enrol button); only open courses offer Enrol Now there", () => {
    const card = read("src/components/course/course-card.tsx");
    assert.match(card, /const href = `\/courses\/\$\{course\.slug\}`/);
    assert.doesNotMatch(card, /\/dashboard\/enrol|course\.price|totalFee/);
    const detail = read("src/app/(public)/courses/[slug]/page.tsx");
    assert.match(detail, /\{open \? \([\s\S]*?\/enrol\/\$\{course\.slug\}`\}>Enrol Now[\s\S]*?\) : \(/);
    // Guests can enrol; signed-in students are sent to their dashboard enrolment.
    assert.match(read("src/app/(public)/enrol/[slug]/page.tsx"), /if \(user\?\.role === "student"\) redirect\(`\/dashboard\/enrol\//);
  });
  test("the enrolment page requires a student session and pays only through the existing Razorpay button", () => {
    const page = read("src/app/(account)/dashboard/enrol/[slug]/page.tsx");
    assert.match(page, /await requireRole\("student", `\/dashboard\/enrol\//);
    assert.match(page, /<PayOnlineButton kind="registration" id=\{r\.id\}/);
    assert.match(page, /r\.status === "pending_payment"/);
    assert.match(page, /course\.availability !== "open"/);
    assert.match(page, /preferred days and times are requests, not a confirmed booking/);
    assert.doesNotMatch(page, /razorpay\.com|RAZORPAY_|createRazorpayOrder|processVerifiedGatewayPayment/);
  });
  test("the registration action is student-only, computes the amount on the server and records no payment", () => {
    const action = read("src/app/(account)/dashboard/registration-actions.ts");
    assert.match(action, /requireActionUser\("student"\)/);
    const server = read("src/lib/lms/server/registrations.ts").replace(/\/\/[^\n]*/g, "");
    const save = server.slice(server.indexOf("export async function saveRegistration"), server.indexOf("export async function getOwnRegistration"));
    // The price comes from the server (course rate, or the fixed Learn Together rates); the initial payment is one session.
    assert.match(save, /const priced = priceEnrolment\(course, input\?\.mode\);/);
    assert.match(save, /course\.fee\?\.batchMinor : course\.fee\?\.individualMinor/);
    assert.match(save, /initialAmountMinor: priced\.sessionMinor/);
    assert.doesNotMatch(save, /col\("payments"\)|gatewayOrders|createRazorpayOrder|status: "paid"|tx\.(set|create|update)\(accountRefs/);
    const teacher = read("src/app/(account)/teacher/registration-actions.ts");
    assert.equal((teacher.match(/requireActionUser\("teacher"\)/g) ?? []).length, 3);
  });
  test("checkout confirmation is a single implementation shared by the action (no parallel payment code)", () => {
    const action = read("src/app/(account)/dashboard/payment-actions.ts");
    assert.match(action, /confirmCheckoutPayment\(user, input\)/);
    assert.doesNotMatch(action, /verifyCheckoutSignature|fetchRazorpayPayment|processVerifiedGatewayPayment/);
    const gateway = read("src/lib/lms/server/gateway.ts");
    assert.match(gateway, /verifyCheckoutSignature\(orderId, paymentId, signature, config\.keySecret\)/);
    // Student and guest confirmations both go through the one shared verification.
    assert.equal((gateway.match(/return verifyAndRecordCheckout\(config, orderId, paymentId, input\.signature\)/g) ?? []).length, 2);
  });
  test("login and register keep the enrolment page as the return path", () => {
    assert.match(read("src/components/auth/auth-shell.tsx"), /<AuthSwitchLink href=\{footer\.href\}/);
    assert.match(read("src/components/auth/auth-switch-link.tsx"), /sanitizeNextPath\(useSearchParams\(\)\.get\("next"\)\)/);
  });
});
