// Pure parsing for payment inputs (shared by Server Actions; unit-testable).

export const MAX_AMOUNT_MINOR = 10_000_000 * 100; // ₹1 crore

/** "2,500.50" → 250050 (paise). Rejects zero, negatives, >2 decimals and junk. */
export function parseAmountMinor(value: unknown): number | null {
  const text =
    typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/[,\s₹]/g, "") : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const minor = Math.round(Number(text) * 100);
  return minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

/** A calendar date (YYYY-MM-DD) in India time, not in the future and not before 2000. */
export function parsePaidAt(value: unknown, now = Date.now()): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00+05:30`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  if (date.getTime() > now + 24 * 60 * 60 * 1000) return null;
  if (date.getUTCFullYear() < 2000) return null;
  return date;
}
