// Live classes (Google Meet) — shared types and PURE helpers (no server
// imports, so they are unit-testable and safe in client components).
//
// Time zone: the academy works in Asia/Kolkata (IST). India has no daylight
// saving time, so IST is always UTC+05:30 and a wall-clock date/time entered
// by a teacher maps to exactly one instant using that fixed offset. All display
// formatting passes timeZone: "Asia/Kolkata" explicitly, so the viewer's own
// device time zone never shifts a class.

export const ACADEMY_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

export const CLASS_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type ClassStatus = (typeof CLASS_STATUSES)[number];

/** Attendance is recorded separately from status, only by a teacher. */
export const ATTENDANCE_VALUES = ["attended", "absent", "unknown"] as const;
export type Attendance = (typeof ATTENDANCE_VALUES)[number];

export const CLASS_STATUS_LABELS: Record<ClassStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Students may join from this many minutes before the start until the scheduled end. */
export const JOIN_EARLY_MINUTES = 15;

export const MIN_CLASS_MINUTES = 15;
export const MAX_CLASS_MINUTES = 4 * 60;

/** Full record, for teachers. */
export interface LiveClassRecord {
  id: string;
  studentId: string;
  title: string;
  /** ISO instants (UTC) of the scheduled start/end. */
  startAt: string;
  endAt: string;
  timeZone: string;
  /** Wall-clock values in IST exactly as entered: YYYY-MM-DD, HH:mm, HH:mm. */
  date: string;
  startTime: string;
  endTime: string;
  meetUrl: string;
  /** Visible to the student. */
  notes: string | null;
  status: ClassStatus;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Teacher-recorded outcome; never sent to students. */
  attendance: Attendance | null;
  outcomeNote: string | null;
  outcomeRecordedAt: string | null;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
}

/** What a student may see about their own class. No teacher-only fields. */
export interface StudentClassView {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  notes: string | null;
  status: ClassStatus;
  cancelReason: string | null;
  /**
   * Only present while the class is scheduled AND inside its joining window
   * (by the server's clock). Never sent for cancelled, completed or ended classes.
   */
  meetUrl: string | null;
  teacherName: string;
}

export function toStudentView(record: LiveClassRecord, teacherName: string, now: number): StudentClassView {
  const joinable = joinPhase(record, now) === "joinable";
  return {
    id: record.id,
    title: record.title,
    startAt: record.startAt,
    endAt: record.endAt,
    notes: record.notes,
    status: record.status,
    cancelReason: record.status === "cancelled" ? record.cancelReason : null,
    meetUrl: joinable ? record.meetUrl : null,
    teacherName,
  };
}

// --- Parsing / validation ----------------------------------------------------------

const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/**
 * Accepts only Google Meet meeting links: https://meet.google.com/abc-defg-hij
 * (query strings such as ?authuser=0 or ?pli=1 are dropped). Returns the
 * canonical URL, or null for anything else (other hosts, http:, lookalikes,
 * credentials in the URL, other paths).
 */
export function normalizeMeetUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.port || url.username || url.password) return null;
  const code = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return MEET_CODE.test(code) ? `https://meet.google.com/${code}` : null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** YYYY-MM-DD + HH:mm in IST → Date, or null when either is malformed or the date doesn't exist. */
export function istToInstant(date: string, time: string): Date | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
  const instant = new Date(`${date}T${time}:00${IST_OFFSET}`);
  if (Number.isNaN(instant.getTime())) return null;
  // Reject impossible dates such as 2026-02-30 (JS would roll them over).
  return istDateOf(instant) === date ? instant : null;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/**
 * IST calendar/clock parts of an instant, by plain arithmetic. IST is a fixed
 * UTC+05:30 (no daylight saving), so this is exact — and, unlike Intl, it
 * gives identical results on every server and browser (no ICU/locale data
 * differences, so no hydration mismatches).
 */
export function istParts(instant: Date) {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0–11
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export function istDateOf(instant: Date): string {
  const p = istParts(instant);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

/** The IST wall-clock time (HH:mm, 24-hour) of an instant. */
export function istTimeOf(instant: Date): string {
  const p = istParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export interface ClassTimeInput {
  date: unknown;
  startTime: unknown;
  endTime: unknown;
}

export type ClassTimeResult =
  | { ok: true; start: Date; end: Date; date: string; startTime: string; endTime: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates a class's date and times (all IST). `now` is passed in for
 * testability; `allowPast` lets a teacher keep an already-started class's
 * times unchanged when only editing the title, link or notes.
 */
export function parseClassTimes(input: ClassTimeInput, now: number, allowPast = false): ClassTimeResult {
  const errors: Record<string, string> = {};
  const date = typeof input?.date === "string" ? input.date.trim() : "";
  const startTime = typeof input?.startTime === "string" ? input.startTime.trim() : "";
  const endTime = typeof input?.endTime === "string" ? input.endTime.trim() : "";
  if (!DATE_PATTERN.test(date)) errors.date = "Choose the class date.";
  if (!TIME_PATTERN.test(startTime)) errors.startTime = "Enter the start time.";
  if (!TIME_PATTERN.test(endTime)) errors.endTime = "Enter the expected end time.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const start = istToInstant(date, startTime);
  const end = istToInstant(date, endTime);
  if (!start) return { ok: false, errors: { date: "That date does not exist." } };
  if (!end || end.getTime() <= start.getTime()) return { ok: false, errors: { endTime: "The end time must be after the start time." } };
  const minutes = (end.getTime() - start.getTime()) / 60000;
  if (minutes < MIN_CLASS_MINUTES) return { ok: false, errors: { endTime: `A class must be at least ${MIN_CLASS_MINUTES} minutes long.` } };
  if (minutes > MAX_CLASS_MINUTES) return { ok: false, errors: { endTime: `A class can be at most ${MAX_CLASS_MINUTES / 60} hours long.` } };
  if (!allowPast && start.getTime() < now - 5 * 60 * 1000) {
    return { ok: false, errors: { startTime: "The class cannot start in the past." } };
  }
  if (start.getTime() > now + 366 * 24 * 60 * 60 * 1000) return { ok: false, errors: { date: "Schedule classes at most a year ahead." } };
  return { ok: true, start, end, date, startTime, endTime };
}

// --- Join window ----------------------------------------------------------------------

export type JoinPhase = "upcoming" | "joinable" | "ended" | "completed" | "cancelled";

/**
 * What a student can do right now. Based only on the schedule and the
 * teacher-recorded status — never on whether anyone actually joined.
 */
export function joinPhase(view: Pick<StudentClassView, "status" | "startAt" | "endAt">, now: number): JoinPhase {
  if (view.status === "cancelled") return "cancelled";
  if (view.status === "completed") return "completed";
  const opens = Date.parse(view.startAt) - JOIN_EARLY_MINUTES * 60 * 1000;
  const ends = Date.parse(view.endAt);
  if (now < opens) return "upcoming";
  if (now <= ends) return "joinable";
  return "ended";
}

// --- Client timing decisions (pure, for the student's class list) ------------------

type TimedClass = Pick<StudentClassView, "status" | "startAt" | "endAt" | "meetUrl">;

/** When the joining window of a class opens. */
export function windowOpensAt(c: Pick<StudentClassView, "startAt">): number {
  return Date.parse(c.startAt) - JOIN_EARLY_MINUTES * 60 * 1000;
}

/**
 * The next instant after `now` at which any scheduled class changes phase
 * (window opens, or the scheduled end passes). null when nothing is pending.
 */
export function nextPhaseBoundary(classes: TimedClass[], now: number): number | null {
  const times = classes
    .filter((c) => c.status === "scheduled")
    .flatMap((c) => [windowOpensAt(c), Date.parse(c.endAt) + 1])
    .filter((t) => t > now);
  return times.length ? Math.min(...times) : null;
}

/** The next joining window that opens after `serverClock` (server data must be refetched then). */
export function nextWindowOpen(classes: TimedClass[], serverClock: number): number | null {
  const times = classes
    .filter((c) => c.status === "scheduled")
    .map(windowOpensAt)
    .filter((t) => t > serverClock);
  return times.length ? Math.min(...times) : null;
}

/** A class is joinable by this clock but the server has not supplied its link yet. */
export function isWaitingForLink(classes: TimedClass[], now: number): boolean {
  return classes.some((c) => joinPhase(c, now) === "joinable" && !c.meetUrl);
}

// --- Display (always IST, deterministic) ---------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "6:00 pm", "12:05 am" */
export function formatIstClock(instant: Date): string {
  const { hour, minute } = istParts(instant);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)} ${hour < 12 ? "am" : "pm"}`;
}

/** e.g. "Mon, 12 Oct 2026" */
export function formatIstDay(instant: Date): string {
  const p = istParts(instant);
  return `${WEEKDAYS[p.weekday]}, ${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** e.g. "Mon, 12 Oct 2026 · 6:00 pm – 7:00 pm IST" */
export function formatClassTime(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return `${formatIstDay(start)} · ${formatIstClock(start)} – ${formatIstClock(end)} IST`;
}
