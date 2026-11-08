// Unit tests for website registration rules (pure): class types and initial
// payments, student details validation, preferred scheduling, weekly batch
// schedules and conflicts, and the status labels students and teachers see.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ageOn,
  istToday,
  parseRegistrationDetails,
  parseWeeklySchedule,
  registrationId,
  registrationStatusLabel,
  scheduleLabel,
  schedulesConflict,
} from "../../src/lib/lms/registration.ts";

const TODAY = "2026-11-02";
const adult = (overrides = {}) => ({
  fullName: "Anjali Menon",
  email: "Anjali@Example.test",
  mobile: "+91 98470 00000",
  age: "34",
  address: "12 Temple Road, Thrissur",
  preferredDays: ["tue", "sat"],
  preferredTimes: [{ start: "19:00", end: "20:00" }],
  notes: "",
  ...overrides,
});
const child = (overrides = {}) =>
  adult({
    fullName: "Meera",
    age: "",
    dateOfBirth: "2016-05-20",
    guardianName: "Lakshmi",
    guardianRelationship: "Mother",
    guardianPhone: "+91 98470 00000",
    ...overrides,
  });

describe("class type and initial payment", () => {
  test("one registration per student and course (deterministic id)", () => {
    assert.equal(registrationId("uid1", "carnatic-vocal"), "uid1_carnatic-vocal");
    assert.equal(registrationId("uid1", "carnatic-vocal"), registrationId("uid1", "carnatic-vocal"));
  });
  test("status labels after verified payment", () => {
    assert.equal(registrationStatusLabel("pending_payment", "batch"), "Awaiting payment");
    assert.equal(registrationStatusLabel("paid", "batch"), "Paid — Awaiting Batch Assignment");
    assert.equal(registrationStatusLabel("paid", "individual"), "Paid — Awaiting Schedule Confirmation");
    assert.equal(registrationStatusLabel("assigned", "batch"), "Active — Schedule Confirmed");
    assert.equal(registrationStatusLabel("scheduled", "individual"), "Active — Schedule Confirmed");
  });
});

describe("student details validation", () => {
  test("a valid adult needs no guardian", () => {
    const { value, errors } = parseRegistrationDetails(adult(), TODAY);
    assert.deepEqual(errors, {});
    assert.equal(value.age, 34);
    assert.equal(value.guardian, null);
  });
  test("age from the date of birth (IST date); under 18 requires a parent or guardian", () => {
    assert.equal(ageOn("2016-05-20", TODAY), 10);
    assert.equal(ageOn("2008-11-03", TODAY), 17);
    assert.equal(ageOn("2008-11-02", TODAY), 18);
    const missing = parseRegistrationDetails(child({ guardianName: "", guardianRelationship: "", guardianPhone: "" }), TODAY);
    assert.equal(missing.value, null);
    assert.ok(missing.errors.guardianName && missing.errors.guardianRelationship && missing.errors.guardianPhone);
    const ok = parseRegistrationDetails(child(), TODAY);
    assert.deepEqual(ok.errors, {});
    assert.equal(ok.value.age, 10);
    assert.deepEqual(ok.value.guardian, { name: "Lakshmi", relationship: "Mother", phone: "+91 98470 00000", email: null });
  });
  test("required fields and bounds", () => {
    const { errors } = parseRegistrationDetails({ fullName: "A", address: "x", preferredDays: [], preferredTimes: [] }, TODAY);
    for (const k of ["fullName", "age", "address", "preferredDays", "preferredTimes"]) assert.ok(errors[k], k);
    assert.ok(parseRegistrationDetails(adult({ age: "2" }), TODAY).errors.age);
    assert.ok(parseRegistrationDetails(adult({ age: "12.5" }), TODAY).errors.age);
    assert.ok(parseRegistrationDetails(adult({ age: "", dateOfBirth: "2030-01-01" }), TODAY).errors.dateOfBirth);
    assert.ok(parseRegistrationDetails(adult({ age: "", dateOfBirth: "20-01-2010" }), TODAY).errors.dateOfBirth);
    assert.ok(parseRegistrationDetails(adult({ guardianName: "X Y", guardianRelationship: "Father", guardianPhone: "12", guardianEmail: "bad" }), TODAY).errors.guardianPhone);
  });
  test("text is trimmed, control characters removed and lengths capped", () => {
    const { value } = parseRegistrationDetails(adult({ fullName: "  Anjali\u0000 Menon  ", notes: "n".repeat(900) }), TODAY);
    assert.equal(value.fullName, "Anjali Menon");
    assert.equal(value.notes.length, 500);
  });
});

describe("preferred scheduling (requests, not bookings)", () => {
  test("multiple days and multiple time slots; deduplicated and sorted", () => {
    const { value } = parseRegistrationDetails(
      adult({
        preferredDays: ["sat", "mon", "sat"],
        preferredTimes: [
          { start: "18:00", end: "19:00" },
          { start: "07:00", end: "08:00" },
          { start: "18:00", end: "19:00" },
          { start: "", end: "" },
        ],
      }),
      TODAY,
    );
    assert.deepEqual(value.preferredDays, ["mon", "sat"]);
    assert.deepEqual(value.preferredTimes, [
      { start: "07:00", end: "08:00" },
      { start: "18:00", end: "19:00" },
    ]);
  });
  test("unknown days, bad or reversed times and too many slots are refused", () => {
    assert.ok(parseRegistrationDetails(adult({ preferredDays: ["funday"] }), TODAY).errors.preferredDays);
    assert.ok(parseRegistrationDetails(adult({ preferredTimes: [{ start: "20:00", end: "19:00" }] }), TODAY).errors.preferredTimes);
    assert.ok(parseRegistrationDetails(adult({ preferredTimes: [{ start: "25:00", end: "26:00" }] }), TODAY).errors.preferredTimes);
    const many = Array.from({ length: 7 }, (_, i) => ({ start: `0${i + 1}:00`, end: `0${i + 2}:00` }));
    assert.ok(parseRegistrationDetails(adult({ preferredTimes: many }), TODAY).errors.preferredTimes);
  });
});

describe("weekly batch schedules", () => {
  test("any days and times (no hard-coded slots), with validation", () => {
    const { value } = parseWeeklySchedule({ days: ["sun", "wed"], start: "06:30", end: "07:15" });
    assert.deepEqual(value, { days: ["wed", "sun"], start: "06:30", end: "07:15" });
    assert.equal(scheduleLabel(value), "Wednesday & Sunday, 06:30–07:15 IST");
    assert.ok(parseWeeklySchedule({ days: [], start: "06:30", end: "07:15" }).errors.days);
    assert.ok(parseWeeklySchedule({ days: ["mon"], start: "08:00", end: "08:00" }).errors.endTime);
    assert.ok(parseWeeklySchedule({ days: ["mon"], start: "8am", end: "09:00" }).errors.startTime);
  });
  test("conflicts need a shared day and overlapping times; back-to-back classes are fine", () => {
    const a = { days: ["tue", "sat"], start: "19:00", end: "20:00" };
    assert.equal(schedulesConflict(a, { days: ["sat"], start: "19:30", end: "20:30" }), true);
    assert.equal(schedulesConflict(a, { days: ["sat"], start: "20:00", end: "21:00" }), false);
    assert.equal(schedulesConflict(a, { days: ["wed"], start: "19:00", end: "20:00" }), false);
  });
  test("IST date from a UTC timestamp", () => {
    assert.equal(istToday("2026-11-01T18:30:00.000Z"), "2026-11-02");
    assert.equal(istToday("2026-11-01T18:29:59.999Z"), "2026-11-01");
  });
});

describe("learner contact details", () => {
  test("email is required and lower-cased; mobile needs a country code (E.164)", async () => {
    const { normalizeMobile } = await import("../../src/lib/lms/registration.ts");
    const { value } = parseRegistrationDetails(adult(), TODAY);
    assert.deepEqual([value.email, value.mobile], ["anjali@example.test", "+919847000000"]);
    assert.ok(parseRegistrationDetails(adult({ email: "not-an-email" }), TODAY).errors.email);
    assert.ok(parseRegistrationDetails(adult({ mobile: "9847000000" }), TODAY).errors.mobile, "no country code");
    assert.equal(normalizeMobile("+44 (20) 7946-0958"), "+442079460958");
    assert.equal(normalizeMobile("+0123456789"), null);
  });
  test("guest checkout cookie: registration id and token", async () => {
    const { guestCookieName, parseGuestCookie } = await import("../../src/lib/lms/guest-cookie.ts");
    assert.equal(guestCookieName("swara-foundation"), "enrol_swara_foundation");
    assert.deepEqual(parseGuestCookie("g_abc_swara.tok-en_1"), { registrationId: "g_abc_swara", token: "tok-en_1" });
    assert.equal(parseGuestCookie(undefined), null);
    assert.equal(parseGuestCookie("no-dot"), null);
  });
});

describe("enrolment types: Batch – Individual, One-to-One, Learn Together", () => {
  test("fixed rates: ₹400 / ₹750 per learner; Learn Together ₹360 / ₹700 per learner = ₹720 / ₹1,400 per session", async () => {
    const { enrolmentRates, classTypeOf, isSharedEnrolment } = await import("../../src/lib/lms/registration.ts");
    assert.deepEqual(enrolmentRates("batch", 40_000), { perLearnerMinor: 40_000, learnerCount: 1, sessionMinor: 40_000 });
    assert.deepEqual(enrolmentRates("individual", 75_000), { perLearnerMinor: 75_000, learnerCount: 1, sessionMinor: 75_000 });
    assert.deepEqual(enrolmentRates("shared_batch", 40_000), { perLearnerMinor: 36_000, learnerCount: 2, sessionMinor: 72_000 });
    assert.deepEqual(enrolmentRates("shared_individual", 75_000), { perLearnerMinor: 70_000, learnerCount: 2, sessionMinor: 140_000 });
    assert.deepEqual([classTypeOf("shared_batch"), classTypeOf("shared_individual")], ["batch", "individual"]);
    assert.deepEqual([isSharedEnrolment("batch"), isSharedEnrolment("shared_batch")], [false, true]);
  });

  test("Learn Together needs exactly two different learners; individual enrolment one", () => {
    const learner = (name, extra = {}) => ({ fullName: name, age: "30", ...extra });
    const base = adult();
    const two = parseRegistrationDetails({ ...base, learners: [learner("Anu Menon"), learner("Balu Menon")] }, TODAY, { shared: true });
    assert.deepEqual(two.errors, {});
    assert.deepEqual(two.value.learners.map((l) => l.fullName), ["Anu Menon", "Balu Menon"]);
    assert.equal(two.value.fullName, "Anu Menon");
    assert.match(parseRegistrationDetails({ ...base, learners: [learner("Anu")] }, TODAY, { shared: true }).errors.learners, /exactly 2/);
    assert.match(parseRegistrationDetails({ ...base, learners: [learner("A1"), learner("B1"), learner("C1")] }, TODAY, { shared: true }).errors.learners, /exactly 2/);
    assert.match(parseRegistrationDetails({ ...base }, TODAY, { shared: true }).errors.learners, /exactly 2/);
    assert.ok(parseRegistrationDetails({ ...base, learners: [learner("Anu Menon"), learner(" anu  menon ")] }, TODAY, { shared: true }).errors["learners.1.fullName"]);
    // A child learner needs a guardian, reported against that learner.
    const kid = parseRegistrationDetails({ ...base, learners: [learner("Anu Menon"), { fullName: "Kid Menon", age: "9" }] }, TODAY, { shared: true });
    assert.ok(kid.errors["learners.1.guardianName"]);
    assert.equal(parseRegistrationDetails(base, TODAY).value.learners.length, 1);
  });

  test("a Learn Together enrolment takes two places in a batch", async () => {
    const { canAddMember } = await import("../../src/lib/lms/class-billing.ts");
    const batch = (memberCount) => ({ capacity: 5, memberCount, status: "active" });
    assert.equal(canAddMember(batch(3), 2), null);
    assert.match(canAddMember(batch(4), 2), /1 place\(s\) left; this enrolment needs 2/);
    assert.match(canAddMember(batch(5), 1), /full/);
  });
});
