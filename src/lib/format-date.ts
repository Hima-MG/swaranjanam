// Date display helpers for dashboards. Fixed locale and time zone, so server
// and client render the same text.

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function formatDate(iso: string | null | undefined, fallback = "—"): string {
  return iso ? dateFormatter.format(new Date(iso)) : fallback;
}

export function formatDateTime(iso: string | null | undefined, fallback = "—"): string {
  return iso ? dateTimeFormatter.format(new Date(iso)) : fallback;
}
