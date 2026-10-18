// Unit tests for student testimonials (src/lib/lms/testimonials.ts) and a
// regression check that fabricated marketing claims stay out of public pages.
//
// PURE unit tests plus static source checks. They do not run against Firestore
// and do not prove end-to-end authorisation (see the report for manual checks).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  ANONYMOUS_NAME,
  cleanTestimonialText,
  isPublishable,
  moderationTarget,
  parseTestimonialInput,
  publicNameFor,
  TESTIMONIAL_LIMITS,
  toPublicTestimonial,
} from "../../src/lib/lms/testimonials.ts";

const valid = { text: "The classes are patient and well structured.", courseId: "swara-foundation", nameDisplay: "short", consent: true };

describe("testimonial input", () => {
  test("valid input", () => {
    const { value, errors } = parseTestimonialInput(valid);
    assert.deepEqual(errors, {});
    assert.equal(value.courseId, "swara-foundation");
  });

  test("explicit consent is required (missing, false, or a string are all refused)", () => {
    for (const consent of [undefined, false, "on", "true", 1]) {
      const { value, errors } = parseTestimonialInput({ ...valid, consent });
      assert.equal(value, null, String(consent));
      assert.ok(errors.consent);
    }
  });

  test("length limits", () => {
    assert.ok(parseTestimonialInput({ ...valid, text: "too short" }).errors.text);
    assert.ok(parseTestimonialInput({ ...valid, text: "a".repeat(TESTIMONIAL_LIMITS.maxLength + 1) }).errors.text);
    assert.deepEqual(parseTestimonialInput({ ...valid, text: "a".repeat(TESTIMONIAL_LIMITS.maxLength) }).errors, {});
  });

  test("general (no course) is allowed; malformed course ids are refused", () => {
    assert.equal(parseTestimonialInput({ ...valid, courseId: "" }).value.courseId, null);
    assert.ok(parseTestimonialInput({ ...valid, courseId: "../users/x" }).errors.courseId);
  });

  test("an unknown name display option is refused", () => {
    assert.ok(parseTestimonialInput({ ...valid, nameDisplay: "email" }).errors.nameDisplay);
  });

  test("control characters and bidi overrides are stripped; HTML stays inert text", () => {
    const cleaned = cleanTestimonialText("Lovely\u0000 class‮ <script>alert(1)</script>\r\n\r\n\r\n\r\nThanks");
    assert.equal(cleaned.includes("\u0000"), false);
    assert.equal(cleaned.includes("‮"), false);
    assert.ok(cleaned.includes("\n\nThanks"));
    // React escapes text, so markup is shown literally rather than executed.
    assert.ok(cleaned.includes("<script>"));
  });

  test("the student id is never taken from the input", () => {
    const { value } = parseTestimonialInput({ ...valid, studentId: "someone-else" });
    assert.equal("studentId" in value, false);
  });
});

describe("public name", () => {
  test("full, short and anonymous", () => {
    assert.equal(publicNameFor("Lakshmi Ramesh", "full"), "Lakshmi Ramesh");
    assert.equal(publicNameFor("Lakshmi Ramesh", "short"), "Lakshmi R.");
    assert.equal(publicNameFor("Lakshmi", "short"), "Lakshmi");
    assert.equal(publicNameFor("Lakshmi Ramesh", "anonymous"), ANONYMOUS_NAME);
  });
  test("never publishes an email address or an empty name", () => {
    assert.equal(publicNameFor("lakshmi@example.com", "full"), ANONYMOUS_NAME);
    assert.equal(publicNameFor("", "full"), ANONYMOUS_NAME);
    assert.equal(publicNameFor(null, "short"), ANONYMOUS_NAME);
  });
});

describe("publication rules", () => {
  const record = {
    id: "t1", studentId: "uid-123", courseId: "c1", courseTitle: "Swara Foundation", text: "Wonderful teacher.", nameDisplay: "short",
    publicName: "Lakshmi R.", consent: true, status: "approved", moderationNote: "internal", createdAt: null, updatedAt: null, moderatedAt: null, publishedAt: null,
  };

  test("only approved AND consented testimonials are publishable", () => {
    assert.equal(isPublishable(record), true);
    for (const status of ["pending", "rejected", "unpublished", "withdrawn"]) assert.equal(isPublishable({ ...record, status }), false, status);
    assert.equal(isPublishable({ ...record, consent: false }), false);
  });

  test("the public view contains only quote, chosen name and course title", () => {
    const view = toPublicTestimonial(record);
    assert.deepEqual(Object.keys(view).sort(), ["courseTitle", "id", "name", "quote"]);
    assert.equal(JSON.stringify(view).includes("uid-123"), false);
    assert.equal(JSON.stringify(view).includes("internal"), false);
  });

  test("moderation transitions", () => {
    assert.equal(moderationTarget("pending", "approve", true), "approved");
    assert.equal(moderationTarget("pending", "reject", true), "rejected");
    assert.equal(moderationTarget("approved", "unpublish", true), "unpublished");
    assert.equal(moderationTarget("unpublished", "approve", true), "approved");
    assert.equal(moderationTarget("rejected", "approve", true), "approved");
  });

  test("cannot publish without consent, or after the student withdrew it", () => {
    assert.match(moderationTarget("pending", "approve", false), /consent/);
    assert.match(moderationTarget("withdrawn", "approve", true), /withdrew/);
    assert.match(moderationTarget("withdrawn", "unpublish", false), /withdrew/);
  });

  test("invalid transitions are refused", () => {
    assert.match(moderationTarget("approved", "approve", true), /already/);
    assert.match(moderationTarget("approved", "reject", true), /awaiting review/);
    assert.match(moderationTarget("pending", "unpublish", true), /published/);
  });
});

// --- Static checks of the Server Action source -----------------------------------------

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

function actions(file) {
  return read(file).split(/^export async function /m).slice(1);
}

describe("testimonial actions check the right session first", () => {
  test("teacher moderation requires the teacher role", () => {
    const parts = actions("src/app/(account)/teacher/testimonial-actions.ts");
    assert.ok(parts.length > 0);
    for (const part of parts) assert.match(part, /return runAction\("[A-Za-z]+", async \(\) => \{\s*const user = await requireActionUser\("teacher"\);/);
  });

  test("student actions require the student role and use the session uid", () => {
    const source = read("src/app/(account)/dashboard/testimonial-actions.ts");
    const parts = actions("src/app/(account)/dashboard/testimonial-actions.ts");
    assert.ok(parts.length > 0);
    for (const part of parts) assert.match(part, /return runAction\("[A-Za-z]+", async \(\) => \{\s*const user = await requireActionUser\("student"\);/);
    assert.match(source, /studentId: user\.uid/);
    assert.equal(/input\??\.studentId/.test(source), false);
    // Students have no path to approve or publish.
    assert.equal(/status: "approved"/.test(source), false);
  });
});

// --- Fabricated claims must not return ---------------------------------------------------

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|mdx?)$/.test(name) ? [path] : [];
  });
}

describe("public pages contain no fabricated ratings, counts or testimonials", () => {
  const root = fileURLToPath(new URL("../../src/", import.meta.url));
  const publicFiles = [
    ...files(join(root, "app", "(public)")),
    ...files(join(root, "components", "home")),
    ...files(join(root, "components", "shared")),
    ...files(join(root, "components", "course")),
    ...files(join(root, "data")),
    join(root, "config", "site.ts"),
  ];

  test(`scanned ${publicFiles.length} files`, () => assert.ok(publicFiles.length > 10));

  for (const [label, pattern] of [
    ["student counts like 500+", /\b\d[\d,]*\+\s*(students|learners|families)/i],
    ["star-rating figures", /\b[0-5]\.\d\s*\/\s*5\b|average rating/i],
    ["years-of-experience claims", /\b\d+\+?\s*years? of (teaching|experience)/i],
    ["hardcoded testimonial arrays", /export const testimonials\b/],
    ["success-rate claims", /\b\d+\s*%\s*(success|pass)/i],
  ]) {
    test(`no ${label}`, () => {
      const hits = publicFiles.filter((f) => pattern.test(readFileSync(f, "utf8")));
      assert.deepEqual(hits, []);
    });
  }
});
