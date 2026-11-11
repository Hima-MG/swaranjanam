import { createHash } from "node:crypto";

/** Deterministic document id of a notification (and its email) from its event key: the idempotency key. */
export function notificationId(eventKey: string): string {
  return `n_${createHash("sha256").update(eventKey).digest("hex").slice(0, 40)}`;
}

export const NOTIFICATION_ID_PATTERN = /^n_[a-f0-9]{40}$/;
