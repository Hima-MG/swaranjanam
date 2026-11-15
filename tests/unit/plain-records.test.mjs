// Records passed from Server Components to Client Components must be plain
// data. A course's stored pricing carries an `updatedAt` Firestore Timestamp;
// passing it through unchanged crashed the teacher course editor in
// production ("Only plain objects … can be passed to Client Components").
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Timestamp } from "firebase-admin/firestore";

const { mapCourse, plainData } = await import("../../src/lib/lms/server/db.ts");

/** True when every nested value is a primitive, array or plain object (what React can serialise). */
function isPlain(value) {
  if (value === null || typeof value !== "object") return typeof value !== "function" && typeof value !== "symbol";
  if (Array.isArray(value)) return value.every(isPlain);
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value).every(isPlain);
}

const snap = (id, data) => ({ id, data: () => data });

describe("plain records for Client Components", () => {
  test("plainData converts Timestamps and Dates to ISO strings and drops class instances", () => {
    const at = Timestamp.fromDate(new Date("2026-11-15T10:00:00.000Z"));
    class Ref {}
    const out = plainData({ a: 1, at, when: new Date("2026-01-01T00:00:00.000Z"), nested: [{ at }], ref: new Ref(), s: "x", n: null });
    assert.deepEqual(out, { a: 1, at: "2026-11-15T10:00:00.000Z", when: "2026-01-01T00:00:00.000Z", nested: [{ at: "2026-11-15T10:00:00.000Z" }], s: "x", n: null });
    assert.ok(isPlain(out));
  });

  test("a course with saved pricing (updatedAt Timestamp) maps to a fully plain record", () => {
    const course = mapCourse(
      snap("L8g8bDaKXOjSqh3nYf50", {
        title: "Course",
        status: "published",
        pricing: {
          batchEnabled: true,
          individualEnabled: true,
          batchMinor: 40_000,
          individualMinor: 75_000,
          sharedBatchMinor: 36_000,
          sharedIndividualMinor: 70_000,
          batchCapacity: 5,
          currency: "INR",
          updatedAt: Timestamp.now(),
          updatedBy: "teacher-uid",
        },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
    assert.ok(isPlain(course), "mapped course must contain no class instances");
    assert.equal(typeof course.storedPricing.updatedAt, "string");
    assert.equal(course.storedPricing.batchMinor, 40_000);
  });
});
