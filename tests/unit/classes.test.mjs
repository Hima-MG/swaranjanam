// Unit tests for live-class logic (src/lib/lms/classes.ts).
// Run with: npm test   (Node's built-in test runner; no extra dependencies)
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatClassTime,
  formatIstClock,
  formatIstDay,
  isWaitingForLink,
  istDateOf,
  istTimeOf,
  istToInstant,
  joinPhase,
  nextPhaseBoundary,
  nextWindowOpen,
  normalizeMeetUrl,
  parseClassTimes,
  toStudentView,
} from "../../src/lib/lms/classes.ts";

describe("normalizeMeetUrl", () => {
  test("accepts a standard Meet link", () => {
    assert.equal(normalizeMeetUrl("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  });
  test("canonicalises case, whitespace, trailing slash and query string", () => {
    assert.equal(normalizeMeetUrl("  https://meet.google.com/ABC-defg-hij/?authuser=1 "), "https://meet.google.com/abc-defg-hij");
  });
  for (const [name, value] of [
    ["http (not https)", "http://meet.google.com/abc-defg-hij"],
    ["lookalike host", "https://meet.google.com.evil.example/abc-defg-hij"],
    ["subdomain", "https://x.meet.google.com/abc-defg-hij"],
    ["credentials in URL", "https://user:pw@meet.google.com/abc-defg-hij"],
    ["explicit port", "https://meet.google.com:8443/abc-defg-hij"],
    ["wrong code shape", "https://meet.google.com/abcd-efg-hij"],
    ["digits in code", "https://meet.google.com/ab1-defg-hij"],
    ["other Meet path", "https://meet.google.com/lookup/abc"],
    ["other provider", "https://zoom.us/j/123"],
    ["javascript: URL", "javascript:alert(1)"],
    ["empty string", ""],
    ["over-long input", `https://meet.google.com/abc-defg-hij?${"x".repeat(400)}`],
  ]) {
    test(`rejects ${name}`, () => assert.equal(normalizeMeetUrl(value), null));
  }
  test("rejects non-strings", () => {
    assert.equal(normalizeMeetUrl(42), null);
    assert.equal(normalizeMeetUrl(null), null);
    assert.equal(normalizeMeetUrl(undefined), null);
  });
});

describe("IST conversion", () => {
  test("18:00 IST is 12:30 UTC", () => {
    assert.equal(istToInstant("2026-10-12", "18:00").toISOString(), "2026-10-12T12:30:00.000Z");
  });
  test("00:15 IST falls on the previous UTC day", () => {
    assert.equal(istToInstant("2026-10-12", "00:15").toISOString(), "2026-10-11T18:45:00.000Z");
  });
  test("23:59 IST stays on the same IST date", () => {
    const instant = istToInstant("2026-12-31", "23:59");
    assert.equal(instant.toISOString(), "2026-12-31T18:29:00.000Z");
    assert.equal(istDateOf(instant), "2026-12-31");
  });
  test("rejects impossible dates and times", () => {
    assert.equal(istToInstant("2026-02-30", "10:00"), null);
    assert.equal(istToInstant("2026-10-12", "24:00"), null);
    assert.equal(istToInstant("2026-10-12", "9:00"), null);
    assert.equal(istToInstant("12-10-2026", "09:00"), null);
  });
  test("accepts 29 Feb only in leap years", () => {
    assert.notEqual(istToInstant("2028-02-29", "10:00"), null);
    assert.equal(istToInstant("2026-02-29", "10:00"), null);
  });
  test("istDateOf / istTimeOf round-trip", () => {
    const instant = istToInstant("2026-10-12", "18:05");
    assert.equal(istDateOf(instant), "2026-10-12");
    assert.equal(istTimeOf(instant), "18:05");
  });
});

describe("parseClassTimes", () => {
  const now = Date.parse("2026-10-11T10:00:00+05:30");
  const parse = (date, startTime, endTime, allowPast) => parseClassTimes({ date, startTime, endTime }, now, allowPast);

  test("valid one-hour class", () => {
    const r = parse("2026-10-12", "18:00", "19:00");
    assert.equal(r.ok, true);
    assert.equal(r.start.toISOString(), "2026-10-12T12:30:00.000Z");
    assert.equal(r.end.toISOString(), "2026-10-12T13:30:00.000Z");
  });
  test("end before start", () => {
    assert.deepEqual(parse("2026-10-12", "18:00", "17:00").errors, { endTime: "The end time must be after the start time." });
  });
  test("end equal to start", () => assert.equal(parse("2026-10-12", "18:00", "18:00").ok, false));
  test("shorter than 15 minutes", () => assert.match(parse("2026-10-12", "18:00", "18:10").errors.endTime, /at least 15/));
  test("exactly 15 minutes is allowed", () => assert.equal(parse("2026-10-12", "18:00", "18:15").ok, true));
  test("longer than 4 hours", () => assert.match(parse("2026-10-12", "08:00", "13:00").errors.endTime, /at most 4/));
  test("start in the past", () => {
    assert.equal(parse("2026-10-10", "18:00", "19:00").errors.startTime, "The class cannot start in the past.");
  });
  test("past start allowed when the time is unchanged (edit of details only)", () => {
    assert.equal(parse("2026-10-10", "18:00", "19:00", true).ok, true);
  });
  test("more than a year ahead", () => assert.match(parse("2028-01-01", "10:00", "11:00").errors.date, /a year/));
  test("missing fields report every field", () => {
    assert.deepEqual(Object.keys(parse("", "", "").errors).sort(), ["date", "endTime", "startTime"]);
  });
  test("non-string input is treated as missing", () => {
    assert.equal(parseClassTimes({ date: 20261012, startTime: null, endTime: {} }, now).ok, false);
  });
});

describe("joinPhase", () => {
  const view = { status: "scheduled", startAt: "2026-10-12T12:30:00.000Z", endAt: "2026-10-12T13:30:00.000Z" };
  const at = (iso) => Date.parse(iso);
  test("before the window", () => assert.equal(joinPhase(view, at("2026-10-12T12:14:59.999Z")), "upcoming"));
  test("opens exactly 15 minutes before start", () => assert.equal(joinPhase(view, at("2026-10-12T12:15:00Z")), "joinable"));
  test("joinable exactly at class start", () => assert.equal(joinPhase(view, at("2026-10-12T12:30:00Z")), "joinable"));
  test("during the class", () => assert.equal(joinPhase(view, at("2026-10-12T13:00:00Z")), "joinable"));
  test("still joinable at the scheduled end", () => assert.equal(joinPhase(view, at("2026-10-12T13:30:00Z")), "joinable"));
  test("ended after the scheduled end", () => assert.equal(joinPhase(view, at("2026-10-12T13:30:00.001Z")), "ended"));
  test("cancelled is never joinable", () => assert.equal(joinPhase({ ...view, status: "cancelled" }, at("2026-10-12T13:00:00Z")), "cancelled"));
  test("completed is never joinable", () => assert.equal(joinPhase({ ...view, status: "completed" }, at("2026-10-12T13:00:00Z")), "completed"));
});

describe("IST display (deterministic, no locale data)", () => {
  test("class time", () => {
    assert.equal(
      formatClassTime("2026-10-12T12:30:00.000Z", "2026-10-12T13:30:00.000Z"),
      "Mon, 12 Oct 2026 · 6:00 pm – 7:00 pm IST",
    );
  });
  test("midnight and noon", () => {
    assert.equal(formatIstClock(new Date("2026-10-11T18:30:00Z")), "12:00 am");
    assert.equal(formatIstClock(new Date("2026-10-12T06:30:00Z")), "12:00 pm");
    assert.equal(formatIstClock(new Date("2026-10-11T18:35:00Z")), "12:05 am");
  });
  test("day name uses the IST date, not UTC", () => {
    // 20:00 UTC on Sunday 11 Oct is 01:30 IST on Monday 12 Oct.
    assert.equal(formatIstDay(new Date("2026-10-11T20:00:00Z")), "Mon, 12 Oct 2026");
  });
});

describe("toStudentView", () => {
  const record = {
    id: "c1",
    studentId: "student-a",
    title: "Varnam practice",
    startAt: "2026-10-12T12:30:00.000Z",
    endAt: "2026-10-12T13:30:00.000Z",
    timeZone: "Asia/Kolkata",
    date: "2026-10-12",
    startTime: "18:00",
    endTime: "19:00",
    meetUrl: "https://meet.google.com/abc-defg-hij",
    notes: "Bring your sruti box",
    status: "scheduled",
    cancelledAt: null,
    cancelReason: null,
    attendance: "absent",
    outcomeNote: "PRIVATE TEACHER NOTE",
    outcomeRecordedAt: null,
    createdBy: "teacher-1",
    createdByEmail: "teacher@example.com",
    createdAt: null,
    updatedBy: "teacher-1",
    updatedByEmail: "teacher@example.com",
    updatedAt: null,
  };
  const during = Date.parse("2026-10-12T13:00:00Z");
  const before = Date.parse("2026-10-12T10:00:00Z");
  const after = Date.parse("2026-10-12T14:00:00Z");

  test("never includes teacher-only or identifying fields", () => {
    const view = toStudentView(record, "Swaraanjanam", during);
    for (const key of ["attendance", "outcomeNote", "outcomeRecordedAt", "studentId", "createdBy", "createdByEmail", "updatedBy", "updatedByEmail"]) {
      assert.equal(key in view, false, `${key} must not be present`);
    }
    assert.equal(JSON.stringify(view).includes("PRIVATE TEACHER NOTE"), false);
  });
  test("Meet link only inside the joining window", () => {
    assert.equal(toStudentView(record, "T", during).meetUrl, record.meetUrl);
    assert.equal(toStudentView(record, "T", before).meetUrl, null);
    assert.equal(toStudentView(record, "T", after).meetUrl, null);
  });
  test("cancelled class: no Meet link, reason shown", () => {
    const view = toStudentView({ ...record, status: "cancelled", cancelReason: "Teacher unwell" }, "T", during);
    assert.equal(view.meetUrl, null);
    assert.equal(view.cancelReason, "Teacher unwell");
  });
  test("completed class: no Meet link", () => {
    assert.equal(toStudentView({ ...record, status: "completed" }, "T", during).meetUrl, null);
  });
  test("cancel reason hidden unless cancelled", () => {
    assert.equal(toStudentView({ ...record, cancelReason: "stale" }, "T", during).cancelReason, null);
  });
});

describe("Meet link release uses the server clock at exact boundaries", () => {
  // Class 18:00–19:00 IST = 12:30–13:30 UTC; window opens 12:15 UTC.
  const record = {
    id: "c1", studentId: "s", title: "T", startAt: "2026-10-12T12:30:00.000Z", endAt: "2026-10-12T13:30:00.000Z",
    timeZone: "Asia/Kolkata", date: "2026-10-12", startTime: "18:00", endTime: "19:00",
    meetUrl: "https://meet.google.com/abc-defg-hij", notes: null, status: "scheduled", cancelledAt: null, cancelReason: null,
    attendance: null, outcomeNote: null, outcomeRecordedAt: null, createdBy: null, createdByEmail: null, createdAt: null,
    updatedBy: null, updatedByEmail: null, updatedAt: null,
  };
  const linkAt = (iso, overrides = {}) => toStudentView({ ...record, ...overrides }, "T", Date.parse(iso)).meetUrl;
  test("1 ms before the window: no link", () => assert.equal(linkAt("2026-10-12T12:14:59.999Z"), null));
  test("exactly 15 minutes before start: link", () => assert.equal(linkAt("2026-10-12T12:15:00.000Z"), record.meetUrl));
  test("exactly at start: link", () => assert.equal(linkAt("2026-10-12T12:30:00.000Z"), record.meetUrl));
  test("exactly at scheduled end: link", () => assert.equal(linkAt("2026-10-12T13:30:00.000Z"), record.meetUrl));
  test("1 ms after scheduled end: no link", () => assert.equal(linkAt("2026-10-12T13:30:00.001Z"), null));
  test("cancelled inside the window: no link", () => assert.equal(linkAt("2026-10-12T12:45:00Z", { status: "cancelled" }), null));
  test("completed inside the window: no link", () => assert.equal(linkAt("2026-10-12T12:45:00Z", { status: "completed" }), null));
});

describe("IST across UTC midnight", () => {
  test("a 00:15–01:00 IST class displays on the IST date, not the UTC date", () => {
    const start = istToInstant("2026-10-12", "00:15");
    const end = istToInstant("2026-10-12", "01:00");
    assert.equal(start.toISOString().slice(0, 10), "2026-10-11"); // UTC date is the previous day
    assert.equal(formatClassTime(start.toISOString(), end.toISOString()), "Mon, 12 Oct 2026 · 12:15 am – 1:00 am IST");
  });
  test("a late-night 23:00 IST class stays on its IST date", () => {
    const start = istToInstant("2026-10-12", "23:00");
    assert.equal(start.toISOString(), "2026-10-12T17:30:00.000Z");
    assert.equal(formatIstDay(start), "Mon, 12 Oct 2026");
    assert.equal(istTimeOf(start), "23:00");
  });
  test("year boundary: 31 Dec 23:30 IST is 31 Dec in IST and 31 Dec 18:00 UTC", () => {
    const start = istToInstant("2026-12-31", "23:30");
    assert.equal(formatIstDay(start), "Thu, 31 Dec 2026");
    assert.equal(istDateOf(new Date("2026-12-31T18:45:00Z")), "2027-01-01"); // 00:15 IST on 1 Jan
  });
});

describe("student-page timing helpers", () => {
  const cls = (overrides) => ({
    status: "scheduled", startAt: "2026-10-12T12:30:00.000Z", endAt: "2026-10-12T13:30:00.000Z", meetUrl: null, ...overrides,
  });
  const t = (iso) => Date.parse(iso);

  test("next boundary before the window is the window opening", () => {
    assert.equal(nextPhaseBoundary([cls()], t("2026-10-12T10:00:00Z")), t("2026-10-12T12:15:00Z"));
  });
  test("next boundary inside the window is just after the scheduled end (button removal)", () => {
    assert.equal(nextPhaseBoundary([cls()], t("2026-10-12T12:20:00Z")), t("2026-10-12T13:30:00Z") + 1);
  });
  test("no boundary after the class ended, or for cancelled/completed classes", () => {
    assert.equal(nextPhaseBoundary([cls()], t("2026-10-12T14:00:00Z")), null);
    assert.equal(nextPhaseBoundary([cls({ status: "cancelled" }), cls({ status: "completed" })], t("2026-10-12T10:00:00Z")), null);
  });
  test("picks the earliest boundary across classes", () => {
    const later = cls({ startAt: "2026-10-12T15:00:00.000Z", endAt: "2026-10-12T16:00:00.000Z" });
    assert.equal(nextPhaseBoundary([later, cls()], t("2026-10-12T10:00:00Z")), t("2026-10-12T12:15:00Z"));
  });
  test("next window to refetch for (server clock)", () => {
    assert.equal(nextWindowOpen([cls()], t("2026-10-12T10:00:00Z")), t("2026-10-12T12:15:00Z"));
    assert.equal(nextWindowOpen([cls()], t("2026-10-12T12:15:00Z")), null); // already open: nothing to wait for
    assert.equal(nextWindowOpen([cls({ status: "cancelled" })], t("2026-10-12T10:00:00Z")), null);
  });
  test("waiting for link only while joinable without a link", () => {
    assert.equal(isWaitingForLink([cls()], t("2026-10-12T12:20:00Z")), true);
    assert.equal(isWaitingForLink([cls({ meetUrl: "https://meet.google.com/abc-defg-hij" })], t("2026-10-12T12:20:00Z")), false);
    assert.equal(isWaitingForLink([cls()], t("2026-10-12T12:00:00Z")), false); // before window
    assert.equal(isWaitingForLink([cls()], t("2026-10-12T13:30:00.001Z")), false); // ended: stop retrying
    assert.equal(isWaitingForLink([cls({ status: "cancelled" })], t("2026-10-12T12:20:00Z")), false);
  });
});
