// Student notifications (in-app + email). Shared by the server service and the
// dashboard bell; no server-only imports here.

export const NOTIFICATION_TYPES = [
  "registration_submitted",
  "registration_completed",
  "registration_confirmed",
  "payment_success",
  "payment_failed",
  "payment_received",
  "invoice_generated",
  "payment_due",
  "payment_overdue",
  "batch_assigned",
  "individual_scheduled",
  "schedule_confirmed",
  "class_rescheduled",
  "class_cancelled",
  "recording_available",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A notification as the student's dashboard sees it. */
export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string | null;
}

/** Only same-site paths may be stored as notification links (no open redirects). */
export function safeNotificationLink(link: unknown): string {
  return typeof link === "string" && /^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/.test(link) ? link : "/dashboard";
}
