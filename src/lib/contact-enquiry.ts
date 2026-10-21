// Contact-page enquiry: validation and the prefilled WhatsApp / email links.
//
// PURE module (no runtime imports): used by the Contact form in the browser
// and unit-tested directly. Nothing is sent or stored by the website — the
// visitor sends the prefilled message from their own WhatsApp or email app.

export const ENQUIRY_LIMITS = { name: 100, email: 254, phone: 20, message: 1000 } as const;

export interface EnquiryInput {
  name: unknown;
  email: unknown;
  phone: unknown;
  /** Course title chosen in "Interested in", or empty for "Not sure yet". */
  course: unknown;
  message: unknown;
}

export interface Enquiry {
  name: string;
  email: string;
  phone: string;
  course: string;
  message: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

/** Validates the form. Returns the cleaned enquiry, or field errors keyed by field name. */
export function parseEnquiry(input: EnquiryInput): { value: Enquiry | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = clean(input.name, ENQUIRY_LIMITS.name).replace(/\s+/g, " ");
  const email = clean(input.email, ENQUIRY_LIMITS.email).toLowerCase();
  const phone = clean(input.phone, ENQUIRY_LIMITS.phone);
  const course = clean(input.course, 150);
  const message = clean(input.message, ENQUIRY_LIMITS.message);

  if (!name) errors.name = "Please enter your name.";
  if (!email) errors.email = "Please enter your email address.";
  else if (!EMAIL.test(email)) errors.email = "Please enter a valid email address, like name@example.com.";
  if (phone && !PHONE.test(phone)) errors.phone = "Please enter a valid phone number, or leave it empty.";
  if (typeof input.message === "string" && input.message.trim().length > ENQUIRY_LIMITS.message) {
    errors.message = `Please keep your message under ${ENQUIRY_LIMITS.message} characters.`;
  }

  if (Object.keys(errors).length > 0) return { value: null, errors };
  return { value: { name, email, phone, course, message }, errors };
}

/** The message text the visitor will send. */
export function enquiryText(e: Enquiry): string {
  return [
    "Namaste! I would like to enquire about classes at Swaraanjanam.",
    "",
    `Name: ${e.name}`,
    `Email: ${e.email}`,
    e.phone ? `Phone: ${e.phone}` : null,
    `Interested in: ${e.course || "Not sure yet"}`,
    e.message ? `\nMessage:\n${e.message}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** WhatsApp click-to-chat link with the message prefilled (the visitor still has to press Send). */
export function whatsappEnquiryUrl(whatsappUrl: string, e: Enquiry): string {
  return `${whatsappUrl}?text=${encodeURIComponent(enquiryText(e))}`;
}

/** Email alternative for visitors who do not use WhatsApp. */
export function emailEnquiryUrl(address: string, e: Enquiry): string {
  const subject = `Enquiry from ${e.name}${e.course ? ` — ${e.course}` : ""}`;
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(enquiryText(e))}`;
}
