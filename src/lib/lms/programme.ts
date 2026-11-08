// Special Programmes (bhajan courses, workshops, short courses) — PURE rules.
//
// A course is a Regular Academy Course unless its record has a `programme`
// object (additive field; older courses have none and stay regular).
//   * Regular: unchanged — first-class payment, monthly invoices, agreed rates.
//   * Special: ONE full payment of the programme fee (priced on the server),
//     no first-class payment, no billing account, no monthly invoice, no
//     deduction. A verified payment confirms the registration and grants access.

import { isValidVideoId } from "@/lib/lms/recordings";

export const PROGRAMME_TYPES = ["bhajan", "workshop", "short_course", "other"] as const;
export type ProgrammeType = (typeof PROGRAMME_TYPES)[number];
export const PROGRAMME_TYPE_LABELS: Record<ProgrammeType, string> = {
  bhajan: "Bhajan course",
  workshop: "Workshop",
  short_course: "Short course",
  other: "Special programme",
};

export const PROGRAMME_STATUSES = ["draft", "coming_soon", "open", "closed"] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];
export const PROGRAMME_STATUS_LABELS: Record<ProgrammeStatus, string> = {
  draft: "Draft",
  coming_soon: "Coming Soon",
  open: "Open",
  closed: "Closed",
};

export interface ProgrammeSession {
  /** Stable id derived from date + start ("2026-12-05_1800"). */
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  /** Registered participants only; never public. */
  recordingVideoId: string | null;
}

export interface ProgrammeInfo {
  programmeType: ProgrammeType;
  feeMinor: number;
  durationText: string;
  startDate: string;
  endDate: string;
  sessions: ProgrammeSession[];
  /** Null = no limit. */
  maxParticipants: number | null;
  /** Shown to registered participants. */
  materials: string;
  recordingsAvailable: boolean;
  status: ProgrammeStatus;
}

/** What the public website may show (no recordings, no materials). */
export interface PublicProgramme {
  programmeType: ProgrammeType;
  feeMinor: number;
  durationText: string;
  startDate: string;
  endDate: string;
  sessions: { date: string; start: string; end: string; title: string }[];
  maxParticipants: number | null;
  recordingsAvailable: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const MAX_PROGRAMME_FEE_MINOR = 10_000_000; // ₹1,00,000

export function sessionId(date: string, start: string): string {
  return `${date}_${start.replace(":", "")}`;
}

/**
 * Sessions as entered by the teacher, one per line: "YYYY-MM-DD HH:mm-HH:mm Topic".
 * Recordings already saved are kept for sessions whose date and start time are unchanged.
 */
export function parseSessionLines(
  input: unknown,
  previous: readonly ProgrammeSession[] = [],
): { sessions: ProgrammeSession[]; error: string | null } {
  const lines = (typeof input === "string" ? input : "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 60) return { sessions: [], error: "At most 60 sessions." };
  const kept = new Map(previous.map((s) => [s.id, s.recordingVideoId]));
  const sessions: ProgrammeSession[] = [];
  for (const [i, line] of lines.entries()) {
    const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\s*(.*)$/.exec(line);
    if (!m || !isDate(m[1]) || !TIME.test(m[2]) || !TIME.test(m[3]) || m[2] >= m[3]) {
      return { sessions: [], error: `Line ${i + 1}: use “YYYY-MM-DD HH:mm-HH:mm Topic” with an end after the start.` };
    }
    const id = sessionId(m[1], m[2]);
    if (sessions.some((s) => s.id === id)) return { sessions: [], error: `Line ${i + 1}: two sessions start at the same date and time.` };
    sessions.push({ id, date: m[1], start: m[2], end: m[3], title: text(m[4], 120) || `Session ${i + 1}`, recordingVideoId: kept.get(id) ?? null });
  }
  sessions.sort((a, b) => a.id.localeCompare(b.id));
  return { sessions, error: null };
}

export function parseProgramme(
  input: Record<string, unknown>,
  previous: ProgrammeInfo | null,
): { value: ProgrammeInfo | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const programmeType = (PROGRAMME_TYPES as readonly unknown[]).includes(input.programmeType) ? (input.programmeType as ProgrammeType) : null;
  if (!programmeType) errors.programmeType = "Choose the programme type.";
  const status = (PROGRAMME_STATUSES as readonly unknown[]).includes(input.status) ? (input.status as ProgrammeStatus) : null;
  if (!status) errors.status = "Choose a status.";
  const rupees = Number(String(input.fee ?? "").trim());
  const feeMinor = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || feeMinor <= 0 || feeMinor > MAX_PROGRAMME_FEE_MINOR || Math.abs(rupees * 100 - feeMinor) > 1e-6) {
    errors.fee = "Enter the total fee in rupees (up to ₹1,00,000).";
  }
  const startDate = isDate(input.startDate) ? input.startDate : "";
  const endDate = isDate(input.endDate) ? input.endDate : "";
  if (!startDate) errors.startDate = "Enter the start date.";
  if (!endDate) errors.endDate = "Enter the end date.";
  if (startDate && endDate && endDate < startDate) errors.endDate = "The end date must be on or after the start date.";
  const maxRaw = String(input.maxParticipants ?? "").trim();
  const max = maxRaw === "" ? null : Number(maxRaw);
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 500)) errors.maxParticipants = "Enter a whole number from 1 to 500, or leave it empty.";
  const { sessions, error } = parseSessionLines(input.sessions, previous?.sessions ?? []);
  if (error) errors.sessions = error;
  if (!error && startDate && endDate && sessions.some((s) => s.date < startDate || s.date > endDate)) {
    errors.sessions = "Every session must fall between the start and end dates.";
  }
  if (Object.keys(errors).length > 0) return { value: null, errors };
  return {
    value: {
      programmeType: programmeType!,
      feeMinor,
      durationText: text(input.durationText, 80),
      startDate,
      endDate,
      sessions,
      maxParticipants: max,
      materials: text(input.materials, 2000),
      recordingsAvailable: input.recordingsAvailable === true || input.recordingsAvailable === "on",
      status: status!,
    },
    errors,
  };
}

/** Stored → typed; null for a regular course (no programme object) or an unreadable one. */
export function mapProgramme(raw: unknown): ProgrammeInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const feeMinor = typeof d.feeMinor === "number" && Number.isSafeInteger(d.feeMinor) && d.feeMinor > 0 ? d.feeMinor : null;
  if (feeMinor === null) return null;
  const sessions = (Array.isArray(d.sessions) ? d.sessions : [])
    .map((s) => (s ?? {}) as Record<string, unknown>)
    .filter((s) => isDate(s.date) && TIME.test(String(s.start)) && TIME.test(String(s.end)))
    .map((s) => ({
      id: sessionId(String(s.date), String(s.start)),
      date: String(s.date),
      start: String(s.start),
      end: String(s.end),
      title: text(s.title, 120) || "Session",
      recordingVideoId: isValidVideoId(s.recordingVideoId) ? s.recordingVideoId : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    programmeType: (PROGRAMME_TYPES as readonly unknown[]).includes(d.programmeType) ? (d.programmeType as ProgrammeType) : "other",
    feeMinor,
    durationText: text(d.durationText, 80),
    startDate: isDate(d.startDate) ? d.startDate : "",
    endDate: isDate(d.endDate) ? d.endDate : "",
    sessions,
    maxParticipants: typeof d.maxParticipants === "number" && Number.isInteger(d.maxParticipants) && d.maxParticipants > 0 ? d.maxParticipants : null,
    materials: text(d.materials, 2000),
    recordingsAvailable: d.recordingsAvailable === true,
    status: (PROGRAMME_STATUSES as readonly unknown[]).includes(d.status) ? (d.status as ProgrammeStatus) : "draft",
  };
}

export function toPublicProgramme(p: ProgrammeInfo): PublicProgramme {
  return {
    programmeType: p.programmeType,
    feeMinor: p.feeMinor,
    durationText: p.durationText,
    startDate: p.startDate,
    endDate: p.endDate,
    sessions: p.sessions.map(({ date, start, end, title }) => ({ date, start, end, title })),
    maxParticipants: p.maxParticipants,
    recordingsAvailable: p.recordingsAvailable,
  };
}

/** Public availability of a programme course: Draft is not listed. */
export function programmeAvailability(status: ProgrammeStatus): "open" | "coming_soon" | "closed" | null {
  return status === "draft" ? null : status;
}

/** "YYYY-MM-DD HH:mm-HH:mm Topic" lines for the teacher form. */
export function sessionLines(sessions: readonly ProgrammeSession[]): string {
  return sessions.map((s) => `${s.date} ${s.start}-${s.end} ${s.title}`).join("\n");
}
