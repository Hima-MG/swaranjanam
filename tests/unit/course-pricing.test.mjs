// Unit tests for course-specific pricing, class types, schedule information and
// each student's immutable agreed rate. Pure: no Firebase.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { publicFeesFromPricing } from "../../src/lib/catalog/public-pricing.ts";
import {
  agreedRateForPeriod,
  DEFAULT_BATCH_CAPACITY,
  effectiveCoursePricing,
  existingRateChangeError,
  hasEnrollableClassType,
  mapAgreedRates,
  parseCoursePricing,
  parseScheduleInfo,
  rateFor,
} from "../../src/lib/lms/course-pricing.ts";
import { monthAmounts } from "../../src/lib/lms/class-billing.ts";

const CONFIRMED = { batchMinor: 40_000, individualMinor: 75_000 };

describe("course-specific pricing", () => {
  test("each course has its own prices; class types can be switched off", () => {
    const a = parseCoursePricing({ batchEnabled: "on", batchPrice: "400", individualEnabled: "on", individualPrice: "750" }).value;
    const b = parseCoursePricing({ batchEnabled: "on", batchPrice: "350", individualEnabled: "on", individualPrice: "600" }).value;
    assert.deepEqual([rateFor(a, "batch"), rateFor(a, "individual")], [40_000, 75_000]);
    assert.deepEqual([rateFor(b, "batch"), rateFor(b, "individual")], [35_000, 60_000]);
    const batchOnly = parseCoursePricing({ batchEnabled: "on", batchPrice: "500", individualPrice: "" }).value;
    assert.deepEqual([batchOnly.individualEnabled, rateFor(batchOnly, "individual")], [false, null]);
    assert.deepEqual(publicFeesFromPricing(batchOnly), { batchMinor: 50_000, individualMinor: null, batchAdvanceMinor: 50_000, siblingDiscount: null });
  });

  test("validation: positive amounts only; a disabled type needs no price; at least one type", () => {
    for (const bad of ["-400", "0", "abc", "1e3", "400.123", "₹400", "1000001"]) {
      assert.ok(parseCoursePricing({ batchEnabled: "on", batchPrice: bad }).errors.batchPrice, bad);
    }
    assert.ok(parseCoursePricing({}).errors.classTypes);
    assert.ok(parseCoursePricing({ batchEnabled: "on", batchPrice: "" }).errors.batchPrice);
    assert.deepEqual(parseCoursePricing({ individualEnabled: "on", individualPrice: "750.50" }).value.individualMinor, 75_050);
    assert.ok(parseCoursePricing({ batchEnabled: "on", batchPrice: "400", batchCapacity: "9" }).errors.batchCapacity);
    assert.equal(parseCoursePricing({ batchEnabled: "on", batchPrice: "400" }).value.batchCapacity, DEFAULT_BATCH_CAPACITY);
  });

  test("courses saved before course pricing use the confirmed ₹400/₹750 with both types offered", () => {
    const p = effectiveCoursePricing(null, CONFIRMED);
    assert.deepEqual([p.batchEnabled, p.batchMinor, p.individualEnabled, p.individualMinor], [true, 40_000, true, 75_000]);
    assert.equal(hasEnrollableClassType(p), true);
    // A tampered stored value (negative, string) never becomes a price.
    const tampered = effectiveCoursePricing({ batchEnabled: true, batchMinor: -1, individualEnabled: true, individualMinor: "750" }, CONFIRMED);
    assert.deepEqual([tampered.batchEnabled, tampered.individualEnabled, hasEnrollableClassType(tampered)], [false, false, false]);
  });

  test("schedule information is validated (days, time slots) and is not a booking", () => {
    const { value } = parseScheduleInfo({ days: ["sat", "tue"], timeSlots: [{ start: "18:00", end: "19:00" }, { start: "07:00", end: "08:00" }], frequency: "Weekly", notes: "" });
    assert.deepEqual(value.days, ["tue", "sat"]);
    assert.deepEqual(value.timeSlots[0], { start: "07:00", end: "08:00" });
    assert.ok(parseScheduleInfo({ days: ["funday"] }).errors.days);
    assert.ok(parseScheduleInfo({ timeSlots: [{ start: "19:00", end: "18:00" }] }).errors.timeSlots);
  });
});

describe("a student's agreed rate (immutable history)", () => {
  const rates = [{ effectiveFrom: "2026-11", rateMinor: 35_000 }];

  test("billing uses the student's agreed rate, never the course's latest price", () => {
    assert.equal(agreedRateForPeriod(rates, "2026-11"), 35_000);
    assert.equal(agreedRateForPeriod(rates, "2027-03"), 35_000);
    assert.equal(agreedRateForPeriod([], "2026-11"), null, "older accounts fall back to the versioned rates");
    // Course B example: 5 classes × ₹350 = ₹1,750 − ₹350 initial payment = ₹1,400.
    const lines = Array.from({ length: 5 }, (_, i) => ({ rateMinor: agreedRateForPeriod(rates, "2026-12"), coveredBy: i === 0 ? "advance" : null }));
    assert.deepEqual(monthAmounts(lines), { subtotalMinor: 175_000, initialPaymentMinor: 35_000, amountDueMinor: 140_000 });
  });

  test("an approved change applies only from its month; earlier months keep the old rate", () => {
    const changed = [...rates, { effectiveFrom: "2027-01", rateMinor: 45_000 }];
    assert.equal(agreedRateForPeriod(changed, "2026-12"), 35_000);
    assert.equal(agreedRateForPeriod(changed, "2027-01"), 45_000);
  });

  test("a change for enrolled students starts next month at the earliest, once per month", () => {
    assert.match(existingRateChangeError("2026-11", "2026-11", rates), /next month/);
    assert.match(existingRateChangeError("2026-10", "2026-11", rates), /next month/);
    assert.equal(existingRateChangeError("2026-12", "2026-11", rates), null);
    assert.match(existingRateChangeError("2026-11", "2026-10", rates), /already starts/);
    assert.ok(existingRateChangeError("next", "2026-11", rates));
  });

  test("stored rate entries are sanitised", () => {
    assert.deepEqual(mapAgreedRates([{ effectiveFrom: "2026-11", rateMinor: 40_000, approvedBy: "t" }, { effectiveFrom: "x", rateMinor: 1 }, { effectiveFrom: "2026-12", rateMinor: -5 }]), [
      { effectiveFrom: "2026-11", rateMinor: 40_000 },
    ]);
  });
});
