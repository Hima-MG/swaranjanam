// Name of the HttpOnly cookie that holds a guest's checkout token for one course
// ("{registrationId}.{token}"). Shared by the guest enrolment page and its actions.

export function guestCookieName(slug: string): string {
  return `enrol_${slug.replace(/-/g, "_")}`;
}

export function parseGuestCookie(raw: string | undefined): { registrationId: string; token: string } | null {
  const value = raw ?? "";
  const dot = value.lastIndexOf(".");
  return dot > 0 ? { registrationId: value.slice(0, dot), token: value.slice(dot + 1) } : null;
}
