import "server-only";

import { Resend } from "resend";

// Email transport. Resend in production; a no-send logger in the Firebase
// emulator (unless explicitly enabled) and an injectable fake in tests, so
// tests and local emulator runs never send real email.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend idempotency key: a retried send of the same email is delivered once. */
  idempotencyKey: string;
}

export interface EmailTransport {
  name: string;
  send(email: OutgoingEmail): Promise<{ id: string | null }>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured (RESEND_API_KEY / EMAIL_FROM)");
    this.name = "EmailNotConfiguredError";
  }
}

let override: EmailTransport | null = null;

/** Tests only: replace the transport (null restores the default). */
export function setEmailTransportForTests(transport: EmailTransport | null) {
  override = transport;
}

export function emailSender(): { from: string; replyTo: string | null } | null {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return null;
  return { from, replyTo: process.env.EMAIL_REPLY_TO?.trim() || null };
}

const logTransport: EmailTransport = {
  name: "log",
  async send(email) {
    console.info(`[email] (not sent: emulator) to=${email.to.replace(/^(.).*(@.*)$/, "$1***$2")} subject="${email.subject}"`);
    return { id: null };
  },
};

export function getEmailTransport(): EmailTransport {
  if (override) return override;
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST) || (process.env.FIREBASE_ADMIN_PROJECT_ID ?? "").startsWith("demo-");
  if (emulator && process.env.EMAIL_SEND_IN_EMULATOR !== "true") return logTransport;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = emailSender();
  if (!apiKey || !sender) {
    return {
      name: "unconfigured",
      async send() {
        throw new EmailNotConfiguredError();
      },
    };
  }
  const resend = new Resend(apiKey);
  return {
    name: "resend",
    async send(email) {
      const { data, error } = await resend.emails.send(
        { from: sender.from, to: [email.to], subject: email.subject, html: email.html, text: email.text, ...(sender.replyTo ? { replyTo: sender.replyTo } : {}) },
        { idempotencyKey: email.idempotencyKey },
      );
      if (error) throw new Error(`Resend: ${error.name ?? "error"}: ${error.message ?? ""}`);
      return { id: data?.id ?? null };
    },
  };
}
