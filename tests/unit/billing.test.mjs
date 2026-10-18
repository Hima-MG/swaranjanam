// Unit tests for the billing rules (src/lib/lms/billing.ts).
//
// These are PURE unit tests: they exercise the rules the server applies
// before every write. They do not talk to Firestore and do not prove
// end-to-end authorisation — see the final report for the real-account
// checks that are still required.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildPackageDraft,
  categoryForAge,
  pairTypeOf,
  parsePlanInput,
  parseRupees,
  paiseToRupeesText,
  PUBLISHED_PLANS,
  quotePackage,
  snapshotPlan,
} from "../../src/lib/lms/billing.ts";

const plan = (id) => {
  const p = PUBLISHED_PLANS.find((x) => x.id === id);
  assert.ok(p, `plan ${id} exists`);
  return snapshotPlan(p);
};
const price = (q) => {
  assert.equal(q.ok, true, q.ok ? "" : q.error);
  return q.priceMinor;
};

// --- Pricing --------------------------------------------------------------------

describe("published regular fees (paise)", () => {
  for (const [id, adult, student] of [
    ["swara-foundation", 160_000, 150_000],
    ["devotional-music", 160_000, 150_000],
    ["personal-coaching", 320_000, 300_000],
  ]) {
    test(`${id}: adult ₹${adult / 100}, student ₹${student / 100}, 4 classes`, () => {
      const p = plan(id);
      assert.equal(price(quotePackage(p, "regular", ["adult"])), adult);
      assert.equal(price(quotePackage(p, "regular", ["student"])), student);
      assert.equal(quotePackage(p, "regular", ["adult"]).sessionsIncluded, 4);
    });
  }

  test("Little Swaras: student ₹1,500; no adult individual price", () => {
    const p = plan("little-swaras");
    assert.equal(price(quotePackage(p, "regular", ["student"])), 150_000);
    const adult = quotePackage(p, "regular", ["adult"]);
    assert.equal(adult.ok, false);
    assert.match(adult.error, /not offered at the adult fee/);
  });

  test("coming-soon courses cannot be assigned", () => {
    for (const id of ["geetha-pathway", "kriti-varnam-pathway"]) {
      const q = quotePackage(plan(id), "regular", ["adult"]);
      assert.equal(q.ok, false);
      assert.match(q.error, /coming soon/);
    }
  });

  test("Geetha and Kriti prices are stored and become available once activated", () => {
    const geetha = { ...plan("geetha-pathway"), status: "active" };
    assert.equal(price(quotePackage(geetha, "regular", ["adult"])), 200_000);
    assert.equal(price(quotePackage(geetha, "regular", ["student"])), 190_000);
    const kriti = { ...plan("kriti-varnam-pathway"), status: "active" };
    assert.equal(price(quotePackage(kriti, "regular", ["adult"])), 250_000);
    assert.equal(price(quotePackage(kriti, "regular", ["student"])), 240_000);
  });

  test("inactive plans cannot be assigned", () => {
    const q = quotePackage({ ...plan("swara-foundation"), status: "inactive" }, "regular", ["adult"]);
    assert.equal(q.ok, false);
  });

  test("a regular package is for exactly one learner", () => {
    assert.equal(quotePackage(plan("swara-foundation"), "regular", ["adult", "student"]).ok, false);
    assert.equal(quotePackage(plan("swara-foundation"), "regular", []).ok, false);
  });

  test("unknown categories are rejected", () => {
    assert.equal(quotePackage(plan("swara-foundation"), "regular", ["child"]).ok, false);
  });
});

describe("age category boundary", () => {
  test("15 is a student, 16 is an adult", () => {
    assert.equal(categoryForAge(15), "student");
    assert.equal(categoryForAge(16), "adult");
  });
  test("other ages", () => {
    assert.equal(categoryForAge(5), "student");
    assert.equal(categoryForAge(0), "student");
    assert.equal(categoryForAge(70), "adult");
  });
  for (const bad of [15.5, -1, 121, "16", null, undefined, Number.NaN]) {
    test(`rejects ${String(bad)}`, () => assert.equal(categoryForAge(bad), null));
  }
});

describe("pair plan", () => {
  test("pair type from categories", () => {
    assert.equal(pairTypeOf(["adult", "adult"]), "two_adults");
    assert.equal(pairTypeOf(["student", "adult"]), "adult_student");
    assert.equal(pairTypeOf(["adult", "student"]), "adult_student");
    assert.equal(pairTypeOf(["student", "student"]), "two_students");
  });

  for (const id of ["swara-foundation", "devotional-music"]) {
    test(`${id}: exact published pair fees`, () => {
      const p = plan(id);
      assert.equal(price(quotePackage(p, "pair", ["adult", "adult"])), 288_000);
      assert.equal(price(quotePackage(p, "pair", ["adult", "student"])), 279_000);
      assert.equal(price(quotePackage(p, "pair", ["student", "student"])), 270_000);
      for (const cats of [["adult", "adult"], ["adult", "student"], ["student", "student"]]) {
        assert.equal(quotePackage(p, "pair", cats).needsConfirmation, null);
      }
    });
  }

  test("published pair fees are used as entered, never recalculated", () => {
    // Change the individual fees: the pair fees must not move.
    const p = { ...plan("swara-foundation"), adultPriceMinor: 999_900, studentPriceMinor: 111_100 };
    assert.equal(price(quotePackage(p, "pair", ["adult", "student"])), 279_000);
  });

  test("not available for Geetha, Kriti & Varnam or 1:1 coaching", () => {
    for (const id of ["geetha-pathway", "kriti-varnam-pathway", "personal-coaching"]) {
      const q = quotePackage({ ...plan(id), status: "active" }, "pair", ["adult", "adult"]);
      assert.equal(q.ok, false);
      assert.match(q.error, /pair plan does not apply/);
    }
  });

  test("a pair needs exactly two learners", () => {
    assert.equal(quotePackage(plan("swara-foundation"), "pair", ["adult"]).ok, false);
    assert.equal(quotePackage(plan("swara-foundation"), "pair", ["adult", "adult", "student"]).ok, false);
  });

  test("Little Swaras: two students is a normal pair", () => {
    const q = quotePackage(plan("little-swaras"), "pair", ["student", "student"]);
    assert.equal(price(q), 270_000);
    assert.equal(q.needsConfirmation, null);
  });

  test("Little Swaras parent + child: published pair fee, flagged for teacher confirmation", () => {
    const q = quotePackage(plan("little-swaras"), "pair", ["adult", "student"]);
    assert.equal(price(q), 279_000); // the published "1 adult + 1 student" fee, not an invented one
    assert.match(q.needsConfirmation, /no adult fee for Little Swaras/);
  });

  test("Little Swaras parent + child cannot be assigned without a confirmation reason", () => {
    const learners = [
      { studentId: "parent", category: "adult", name: "Parent" },
      { studentId: "child", category: "student", name: "Child" },
    ];
    const refused = buildPackageDraft(plan("little-swaras"), "pair", learners);
    assert.equal(refused.ok, false);
    assert.ok(refused.needsConfirmation);
    const confirmed = buildPackageDraft(plan("little-swaras"), "pair", learners, "Parent learns with child on one device");
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.draft.priceMinor, 279_000);
    assert.equal(confirmed.draft.confirmation.reason, "Parent learns with child on one device");
  });
});

describe("Voice Culture", () => {
  test("₹2,499 one-time, six sessions over six weeks, all ages", () => {
    const p = plan("voice-culture");
    assert.equal(p.kind, "program");
    assert.equal(p.durationWeeks, 6);
    assert.equal(p.sessionsPerWeek, 1);
    for (const category of ["adult", "student"]) {
      const q = quotePackage(p, "program", [category]);
      assert.equal(price(q), 249_900);
      assert.equal(q.sessionsIncluded, 6);
    }
  });
  test("is not a four-class regular package or a pair", () => {
    assert.equal(quotePackage(plan("voice-culture"), "regular", ["adult"]).ok, false);
    assert.equal(quotePackage(plan("voice-culture"), "pair", ["adult", "adult"]).ok, false);
    assert.equal(quotePackage(plan("swara-foundation"), "program", ["adult"]).ok, false);
  });
  test("uses the configured session count, not a hard-coded six", () => {
    const q = quotePackage({ ...plan("voice-culture"), sessionsIncluded: 8 }, "program", ["adult"]);
    assert.equal(q.sessionsIncluded, 8);
  });
});

describe("integer paise", () => {
  for (const [input, expected] of [
    ["1,600", 160_000],
    ["2499", 249_900],
    ["₹ 99.5", 9_950],
    ["0.07", 7],
    ["2790.10", 279_010],
  ]) {
    test(`parseRupees("${input}") = ${expected}`, () => {
      const v = parseRupees(input);
      assert.equal(v, expected);
      assert.ok(Number.isSafeInteger(v));
    });
  }
  test("empty is null; junk, zero, negatives and 3 decimals are invalid", () => {
    assert.equal(parseRupees(""), null);
    for (const bad of ["abc", "0", "-5", "1.234", "1e3"]) assert.equal(parseRupees(bad), undefined, bad);
  });
  test("every published price is a whole number of paise", () => {
    for (const p of PUBLISHED_PLANS) {
      for (const v of [p.adultPriceMinor, p.studentPriceMinor, p.flatPriceMinor, ...Object.values(p.pairPricesMinor)]) {
        if (v !== null) assert.ok(Number.isSafeInteger(v) && v > 0, `${p.id}: ${v}`);
      }
    }
  });
  test("CSV rupee text has no floating-point error", () => {
    assert.equal(paiseToRupeesText(279_000), "2790.00");
    assert.equal(paiseToRupeesText(7), "0.07");
    assert.equal(paiseToRupeesText(-150_050), "-1500.50");
  });
});

describe("plan editing", () => {
  const base = {
    title: "Swara Foundation", status: "active", adultPrice: "1600", studentPrice: "1500", pairEligible: "on",
    pair_two_adults: "2880", pair_adult_student: "2790", pair_two_students: "2700",
    sessionsIncluded: "4", sessionMinutes: "60", sessionsPerWeek: "1", durationWeeks: "",
  };
  test("valid regular plan", () => {
    const { value, errors } = parsePlanInput("regular", base);
    assert.deepEqual(errors, {});
    assert.equal(value.adultPriceMinor, 160_000);
    assert.equal(value.pairPricesMinor.adult_student, 279_000);
    assert.equal(value.durationWeeks, null);
  });
  test("an empty adult fee means 'not offered'", () => {
    const { value } = parsePlanInput("regular", { ...base, adultPrice: "" });
    assert.equal(value.adultPriceMinor, null);
  });
  test("rejects a plan with no fees, bad sessions and bad status", () => {
    const { errors } = parsePlanInput("regular", { ...base, adultPrice: "", studentPrice: "", sessionsIncluded: "0", status: "open" });
    assert.ok(errors.studentPrice && errors.sessionsIncluded && errors.status);
  });
  test("a program needs a fee and a length in weeks; it never has pair fees", () => {
    const bad = parsePlanInput("program", { ...base, flatPrice: "", durationWeeks: "" });
    assert.ok(bad.errors.flatPrice && bad.errors.durationWeeks);
    const ok = parsePlanInput("program", { ...base, flatPrice: "2499", durationWeeks: "6", sessionsIncluded: "6" });
    assert.deepEqual(ok.errors, {});
    assert.equal(ok.value.flatPriceMinor, 249_900);
    assert.equal(ok.value.pairEligible, false);
    assert.equal(ok.value.adultPriceMinor, null);
  });
});
