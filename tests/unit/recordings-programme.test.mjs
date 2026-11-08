// Pure rules: YouTube recording URLs and Special Programme settings.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { isValidVideoId, parseYouTubeVideoId, youTubeEmbedUrl } = await import("@/lib/lms/recordings");
const { mapProgramme, parseProgramme, parseSessionLines, programmeAvailability, toPublicProgramme } = await import("@/lib/lms/programme");
const { courseEnrolmentChoices } = await import("@/lib/lms/enrolment-options");
const { registrationStatusLabel, parseRegistrationDetails } = await import("@/lib/lms/registration");
const { toStudentView } = await import("@/lib/lms/classes");

const ID = "dQw4w9WgXcQ";

describe("YouTube recording URLs", () => {
  test("accepted: youtube.com/watch (www, bare, m.) and youtu.be, with extra parameters ignored", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=30s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc123`,
      `  https://www.youtube.com/watch?feature=share&v=${ID}  `,
    ]) {
      assert.equal(parseYouTubeVideoId(url), ID, url);
    }
  });

  test("rejected: other domains, lookalikes, http, bad ids, other YouTube paths and non-strings", () => {
    for (const url of [
      `https://vimeo.com/${ID}`,
      `https://www.youtube.com.evil.example/watch?v=${ID}`,
      `https://evil.example/?u=https://youtu.be/${ID}`,
      `https://notyoutube.com/watch?v=${ID}`,
      `http://www.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/watch?v=${ID}x`,
      `https://www.youtube.com/watch?v=<script>12`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://youtu.be/${ID}/extra`,
      `https://user:pw@youtu.be/${ID}`,
      `https://youtu.be:8443/${ID}`,
      `javascript:alert(1)`,
      ID,
      "",
      null,
      42,
    ]) {
      assert.equal(parseYouTubeVideoId(url), null, String(url));
    }
  });

  test("only a validated id is ever embedded (privacy-enhanced domain)", () => {
    assert.equal(isValidVideoId(ID), true);
    assert.equal(youTubeEmbedUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
    assert.throws(() => youTubeEmbedUrl("../../x"));
  });

  test("the student class view never carries the recording id (served only by the enrolment-checked reader)", () => {
    const record = {
      id: "c1", studentId: "s1", packageId: null, sessionKey: null, batchId: null, billingAccountId: null, cancelKind: null, title: "Class 1",
      startAt: "2026-11-07T13:30:00.000Z", endAt: "2026-11-07T14:30:00.000Z", timeZone: "Asia/Kolkata", date: "2026-11-07", startTime: "19:00", endTime: "20:00",
      meetUrl: "https://meet.google.com/abc-defg-hij", notes: null, status: "completed", cancelledAt: null, cancelReason: null, attendance: "attended",
      outcomeNote: null, outcomeRecordedAt: null, recordingVideoId: ID, createdBy: null, createdByEmail: null, createdAt: null, updatedBy: null, updatedByEmail: null, updatedAt: null,
    };
    assert.equal(JSON.stringify(toStudentView(record, "Teacher", Date.now())).includes(ID), false);
  });
});

describe("Special Programme settings", () => {
  const input = (o = {}) => ({
    programmeType: "bhajan", status: "open", fee: "2500", durationText: "4 weeks", startDate: "2026-12-05", endDate: "2026-12-26",
    maxParticipants: "20", sessions: "2026-12-05 18:00-19:00 Introduction\n2026-12-12 18:00-19:00 Second bhajan", materials: "Lyrics sheet", recordingsAvailable: true, ...o,
  });

  test("valid settings: full fee in paise, sessions sorted with stable ids", () => {
    const { value, errors } = parseProgramme(input(), null);
    assert.deepEqual(errors, {});
    assert.equal(value.feeMinor, 250_000);
    assert.deepEqual(value.sessions.map((s) => s.id), ["2026-12-05_1800", "2026-12-12_1800"]);
    assert.equal(value.maxParticipants, 20);
    assert.equal(programmeAvailability("draft"), null, "a draft is never listed publicly");
    assert.equal(programmeAvailability("open"), "open");
  });

  test("invalid fee, dates, limit and session lines are rejected", () => {
    const { value, errors } = parseProgramme(input({ fee: "-1", endDate: "2026-12-01", maxParticipants: "0", sessions: "tomorrow evening", programmeType: "x", status: "live" }), null);
    assert.equal(value, null);
    for (const k of ["fee", "endDate", "maxParticipants", "sessions", "programmeType", "status"]) assert.ok(errors[k], k);
    assert.ok(parseProgramme(input({ sessions: "2027-01-05 18:00-19:00 Late" }), null).errors.sessions, "sessions outside the dates");
    assert.ok(parseSessionLines("2026-12-05 19:00-18:00 Backwards").error);
    assert.ok(parseProgramme(input({ fee: "12.345" }), null).errors.fee);
  });

  test("editing sessions keeps the recordings of unchanged sessions", () => {
    const first = parseProgramme(input(), null).value;
    first.sessions[0].recordingVideoId = ID;
    const edited = parseProgramme(input({ sessions: "2026-12-05 18:00-19:30 Introduction (longer)\n2026-12-19 18:00-19:00 New" }), first).value;
    assert.deepEqual(edited.sessions.map((s) => [s.id, s.recordingVideoId]), [["2026-12-05_1800", ID], ["2026-12-19_1800", null]]);
  });

  test("stored → public: no recordings and no materials on the public website", () => {
    const stored = { ...parseProgramme(input(), null).value };
    stored.sessions = stored.sessions.map((s) => ({ ...s, recordingVideoId: ID }));
    const mapped = mapProgramme(stored);
    assert.equal(mapped.sessions[0].recordingVideoId, ID);
    const pub = JSON.stringify(toPublicProgramme(mapped));
    assert.equal(pub.includes(ID), false);
    assert.equal(pub.includes("Lyrics sheet"), false);
    assert.equal(mapProgramme(undefined), null, "older courses: Regular Academy Course");
    assert.equal(mapProgramme({ feeMinor: 0 }), null);
  });

  test("enrolment choices: one full-fee option for a programme; the four regular types otherwise", () => {
    const programme = toPublicProgramme(parseProgramme(input(), null).value);
    const [only, ...rest] = courseEnrolmentChoices({ fee: null, programme });
    assert.equal(rest.length, 0);
    assert.match(only.rate, /2,500.*total/);
    assert.match(only.detail, /no monthly invoice/);
    const regular = courseEnrolmentChoices({ fee: { batchMinor: 40_000, individualMinor: 75_000 }, programme: null });
    assert.deepEqual(regular.map((c) => c.type), ["batch", "individual", "shared_batch", "shared_individual"]);
  });

  test("status labels and fixed-schedule details (no preferred days/times for a programme)", () => {
    assert.equal(registrationStatusLabel("paid", "batch", "special"), "Paid — Registration confirmed");
    assert.equal(registrationStatusLabel("paid", "batch"), "Paid — Awaiting Batch Assignment", "regular unchanged");
    const base = { fullName: "Anu", email: "anu@example.test", mobile: "+919847000000", age: "30", address: "Thrissur", preferredDays: [], preferredTimes: [] };
    assert.ok(parseRegistrationDetails(base, "2026-11-02").errors.preferredDays, "regular still needs preferences");
    assert.ok(parseRegistrationDetails(base, "2026-11-02", { fixedSchedule: true }).value);
  });
});
