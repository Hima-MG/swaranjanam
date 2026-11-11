import "server-only";

import { siteConfig } from "@/config/site";
import { formatMoney } from "@/lib/format";
import { formatClassTime } from "@/lib/lms/classes";
import { batchMemberId, invoiceDueState, periodLabel } from "@/lib/lms/class-billing";
import { ENROLMENT_TYPE_LABELS, learnerNamesLabel, registrationStatusLabel, scheduleLabel } from "@/lib/lms/registration";
import { mapBatch } from "@/lib/lms/server/batches";
import { readAccountInvoices } from "@/lib/lms/server/class-billing";
import { col, toIso } from "@/lib/lms/server/db";
import { mapRegistration, type RegistrationRecord } from "@/lib/lms/server/registrations";
import { notify, type NotifyOutcome } from "@/lib/notifications/service";

// Business events → student notifications. Each function is called only after
// the operation it reports has committed, reads the committed state itself
// (never browser input), and never throws (see notify()).

const dashboardUrl = (path = "/dashboard") => `${siteConfig.url}${path}`;

function istDateTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " IST";
}

function istDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

async function guarded(label: string, body: () => Promise<NotifyOutcome | NotifyOutcome[] | void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    // Reading the committed state failed: the operation itself already succeeded.
    console.error(`[notifications] ${label} skipped:`, String((error as Error)?.message ?? error).slice(0, 200));
  }
}

function learnerName(r: RegistrationRecord): string {
  return learnerNamesLabel(r.details.learners.map((l) => l.fullName)) || r.details.fullName || "Student";
}

function registrationEmail(r: RegistrationRecord, guestEmail: unknown): string | null {
  return (typeof guestEmail === "string" && guestEmail) || r.studentEmail || r.details.email || null;
}

// --- Registration ------------------------------------------------------------------------------------

/** A signed-in student's registration was saved (initial payment still awaited). In-app only. */
export async function notifyRegistrationSubmitted(userId: string, registrationId: string): Promise<void> {
  await guarded("registration submitted", async () => {
    const r = mapRegistration(await col("registrations").doc(registrationId).get());
    if (!r || r.studentId !== userId || r.status !== "pending_payment") return;
    return notify({
      eventKey: `registration-submitted:${registrationId}`,
      userId,
      type: "registration_submitted",
      title: "Registration submitted",
      message: `Your registration for ${r.courseTitle} (${ENROLMENT_TYPE_LABELS[r.enrolmentType]}) has been received. Complete the ${formatMoney(r.initialAmountMinor)} payment to confirm it.`,
      relatedRecordId: registrationId,
      link: "/dashboard",
    });
  });
}

const PURPOSE_LABELS: Record<string, string> = {
  registration: "Registration (initial payment)",
  invoice: "Monthly invoice",
  advance: "First-class payment",
  session: "Individual session",
};

/**
 * A payment that the SERVER has verified (Razorpay signature/webhook + order
 * checks, or a teacher's explicit verification). Reads the payment record and
 * notifies only when it is paid and verified. Also reports a completed
 * registration when the payment was its initial (or full programme) payment.
 */
export async function notifyVerifiedPayment(paymentDocId: string, via: "online" | "manual"): Promise<void> {
  await guarded("payment", async () => {
    const snap = await col("payments").doc(paymentDocId).get();
    if (!snap.exists || snap.get("status") !== "paid" || snap.get("verified") !== true) return;
    const studentId = String(snap.get("studentId") ?? "") || null;
    const amountMinor = Number(snap.get("amountMinor") ?? 0);
    const purpose = String(snap.get("purpose") ?? "");
    const registrationId = (snap.get("registrationId") as string | null) ?? null;
    const receiptId = (snap.get("receiptId") as string | null) ?? null;
    const needsReview = snap.get("needsReview") === true;
    const regSnap = registrationId ? await col("registrations").doc(registrationId).get() : null;
    const registration = regSnap ? mapRegistration(regSnap) : null;
    const emailTo = registration ? registrationEmail(registration, regSnap?.get("guestEmail")) : null;
    const receiptPath = receiptId ? `/receipts/${receiptId}` : "/dashboard/billing";
    const amount = formatMoney(amountMinor);
    const online = via === "online";
    const outcomes: NotifyOutcome[] = [];

    outcomes.push(
      await notify({
        eventKey: `payment:${paymentDocId}`,
        userId: studentId,
        emailTo,
        type: online ? "payment_success" : "payment_received",
        title: online ? "Payment successful" : "Payment received",
        message: `${amount} received${PURPOSE_LABELS[purpose] ? ` for ${PURPOSE_LABELS[purpose].toLowerCase()}` : ""}${registration ? ` — ${registration.courseTitle}` : ""}.${needsReview ? " The academy will review and contact you." : ""}`,
        relatedRecordId: paymentDocId,
        link: receiptPath,
        email: {
          subject: online ? "Payment Successful — Swaraanjanam" : "Payment Received — Swaraanjanam",
          heading: online ? "Your payment was successful" : "We have received your payment",
          intro: ["Thank you. Your payment has been verified and recorded by the academy."],
          rows: [
            ["Amount", amount],
            ["Payment status", needsReview ? "Received — under review by the academy" : "Paid (verified)"],
            ["For", PURPOSE_LABELS[purpose] ?? "Academy fees"],
            ["Course", registration?.courseTitle],
            ["Receipt", receiptId ? "Available on your dashboard" : null],
          ],
          cta: { label: receiptId ? "View receipt" : "View billing", url: dashboardUrl(receiptPath) },
        },
      }),
    );

    if (registration && purpose === "registration" && !needsReview && registration.status !== "pending_payment" && registration.status !== "cancelled") {
      const special = registration.kind === "special";
      const name = learnerName(registration);
      outcomes.push(
        await notify({
          eventKey: `registration-completed:${registration.id}`,
          userId: studentId,
          emailTo,
          type: special ? "registration_confirmed" : "registration_completed",
          title: special ? "Registration confirmed" : "Registration complete",
          message: special
            ? `Your registration for ${registration.courseTitle} is confirmed. Your programme is now on your dashboard.`
            : `Your registration for ${registration.courseTitle} is complete. The academy will confirm your ${registration.mode === "batch" ? "batch" : "class schedule"} soon.`,
          relatedRecordId: registration.id,
          link: "/dashboard",
          email: {
            subject: "Your Swaraanjanam Registration is Complete",
            heading: `Namaskaram ${name.split(" ")[0]}, your registration is complete`,
            intro: [`Thank you for registering with Swaraanjanam Carnatic Music Academy. Your payment has been verified.`],
            rows: [
              ["Student", name],
              ["Course", registration.courseTitle],
              ["Enrolment type", special ? "Special Programme" : ENROLMENT_TYPE_LABELS[registration.enrolmentType]],
              ["Registration status", registrationStatusLabel(registration.status, registration.mode, registration.kind)],
              ["Payment status", `Paid (verified) — ${amount}`],
            ],
            outro: special
              ? ["Next steps: sign in to your student dashboard to access your programme."]
              : [
                  registration.mode === "batch"
                    ? "Next steps: the academy will assign you to a suitable batch based on teacher availability and your preferred days and times."
                    : "Next steps: the academy will confirm your individual class days and timings based on teacher availability and your preferences.",
                  "You will receive your confirmed schedule on your dashboard and by email.",
                  ...(registration.guest && !studentId ? ["We will also email you a link to set your password and sign in to your student dashboard."] : []),
                ],
            cta: { label: "Open your dashboard", url: dashboardUrl() },
          },
        }),
      );
    }
    return outcomes;
  });
}

/** A signed payment.failed webhook (never a browser message). */
export async function notifyPaymentFailed(orderId: string, gatewayPaymentId: string, reason: string | null): Promise<void> {
  await guarded("payment failed", async () => {
    const order = await col("gatewayOrders").doc(orderId).get();
    if (!order.exists) return;
    const studentId = String(order.get("studentId") ?? "") || null;
    const guestRegistrationId = (order.get("guestRegistrationId") as string | null) ?? null;
    let emailTo: string | null = null;
    if (!studentId && guestRegistrationId) {
      const regSnap = await col("registrations").doc(guestRegistrationId).get();
      const r = mapRegistration(regSnap);
      emailTo = r ? registrationEmail(r, regSnap.get("guestEmail")) : null;
    }
    const amount = formatMoney(Number(order.get("amountMinor") ?? 0));
    const what = String(order.get("description") ?? "") || "your Swaraanjanam payment";
    return notify({
      eventKey: `payment-failed:${gatewayPaymentId}`,
      userId: studentId,
      emailTo,
      type: "payment_failed",
      title: "Payment failed",
      message: `Your payment of ${amount} for ${what} did not go through. No money was taken by the academy; please try again.`,
      relatedRecordId: orderId,
      link: "/dashboard/billing",
      email: {
        subject: "Payment Failed — Swaraanjanam",
        heading: "Your payment did not go through",
        intro: ["We could not complete your recent payment. If any amount was debited, your bank will normally reverse it automatically."],
        rows: [
          ["Amount", amount],
          ["For", what],
          ["Payment status", "Failed"],
          ["Reason", reason],
        ],
        outro: ["You can try the payment again from your dashboard."],
        cta: { label: "Try again", url: dashboardUrl(studentId ? "/dashboard/billing" : "/dashboard") },
      },
    });
  });
}

// --- Invoices ----------------------------------------------------------------------------------------

export async function notifyInvoiceIssued(invoiceId: string): Promise<void> {
  await guarded("invoice", async () => {
    const snap = await col("invoices").doc(invoiceId).get();
    if (!snap.exists || !snap.get("studentId")) return;
    const amount = formatMoney(Number(snap.get("amountDueMinor") ?? 0));
    const label = typeof snap.get("period") === "string" ? periodLabel(snap.get("period")) : "Monthly";
    const course = String(snap.get("courseTitle") ?? "your course");
    const deadline = istDateTime(toIso(snap.get("deadlineAt")));
    return notify({
      eventKey: `invoice:${invoiceId}`,
      userId: String(snap.get("studentId")),
      type: "invoice_generated",
      title: "Monthly invoice generated",
      message: `Your ${label} invoice for ${course} is ${amount}${deadline ? `, payable by ${deadline}` : ""}.`,
      relatedRecordId: invoiceId,
      link: "/dashboard/billing",
      email: {
        subject: `Your ${label} Invoice — Swaraanjanam`,
        heading: `Your ${label} invoice is ready`,
        intro: ["Your monthly invoice for the classes held has been generated."],
        rows: [
          ["Course", course],
          ["Amount due", amount],
          ["Payment status", "Unpaid"],
          ["Pay by", deadline],
        ],
        cta: { label: "View and pay invoice", url: dashboardUrl("/dashboard/billing") },
      },
    });
  });
}

/** How long before the payment deadline the "payment due" reminder is sent (the daily job sends it once). */
export const PAYMENT_REMINDER_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Payment-due reminder (within the 72 hours before the payment deadline) and overdue notice, once
 * per invoice each. Monthly invoices have dueAt = deadlineAt (no "grace" state), so the reminder is
 * based on the deadline itself.
 */
export async function notifyInvoiceDueStates(accountId: string, nowMs = Date.now()): Promise<void> {
  await guarded("invoice reminders", async () => {
    const invoices = await readAccountInvoices(accountId);
    const outcomes: NotifyOutcome[] = [];
    for (const inv of invoices) {
      if (inv.status !== "issued" || inv.summary.balanceMinor <= 0 || !inv.studentId) continue;
      const overdue = invoiceDueState(inv, nowMs) === "overdue";
      if (!overdue && nowMs < Date.parse(inv.deadlineAt) - PAYMENT_REMINDER_WINDOW_MS) continue;
      const balance = formatMoney(inv.summary.balanceMinor);
      const deadline = istDateTime(inv.deadlineAt);
      outcomes.push(
        await notify({
          eventKey: `invoice-${overdue ? "overdue" : "due"}:${inv.id}`,
          userId: inv.studentId,
          type: overdue ? "payment_overdue" : "payment_due",
          title: overdue ? "Payment overdue" : "Payment due",
          message: overdue
            ? `Your ${inv.label} invoice (${balance}) is overdue. Class access is paused until it is paid.`
            : `Reminder: ${balance} for your ${inv.label} invoice is due${deadline ? ` by ${deadline}` : ""}.`,
          relatedRecordId: inv.id,
          link: "/dashboard/billing",
          email: {
            subject: overdue ? "Payment Overdue — Swaraanjanam" : "Payment Reminder — Swaraanjanam",
            heading: overdue ? "Your invoice is overdue" : "A gentle payment reminder",
            intro: [
              overdue
                ? "Your invoice was not paid by its payment deadline, so access to classes and lessons is paused. It is restored as soon as the payment is verified."
                : "Your monthly invoice is due. Please pay before the deadline to keep your classes uninterrupted.",
            ],
            rows: [
              ["Invoice", inv.label],
              ["Course", inv.courseTitle],
              ["Balance due", balance],
              ["Payment status", overdue ? "Overdue" : "Due"],
              ["Pay by", deadline],
            ],
            cta: { label: "Pay now", url: dashboardUrl("/dashboard/billing") },
          },
        }),
      );
    }
    return outcomes;
  });
}

// --- Scheduling --------------------------------------------------------------------------------------

/** A student was placed in a batch (from a registration, added by a teacher, or moved from another batch). */
export async function notifyBatchAssigned(input: { studentId: string; batchId: string; previousBatchName?: string | null }): Promise<void> {
  await guarded("batch assigned", async () => {
    const [batchSnap, memberSnap] = await Promise.all([
      col("batches").doc(input.batchId).get(),
      col("batchMembers").doc(batchMemberId(input.batchId, input.studentId)).get(),
    ]);
    const batch = mapBatch(batchSnap);
    if (!batch || !memberSnap.exists || memberSnap.get("status") !== "active") return;
    // One notice per membership (a later re-join is a new membership with a new joinedAt).
    const joined = toIso(memberSnap.get("joinedAt")) ?? String(memberSnap.updateTime?.toMillis() ?? "");
    const schedule = batch.weekly ? scheduleLabel(batch.weekly) : batch.schedule || "Shared on your dashboard";
    const moved = Boolean(input.previousBatchName);
    return notify({
      eventKey: `batch:${input.batchId}:${input.studentId}:${joined}`,
      userId: input.studentId,
      type: moved ? "class_rescheduled" : "batch_assigned",
      title: moved ? "Your batch has changed" : "You have been assigned to a batch",
      message: moved
        ? `You have moved from ${input.previousBatchName} to ${batch.name} (${batch.courseTitle}). New schedule: ${schedule}.`
        : `You are in ${batch.name} for ${batch.courseTitle}. Schedule: ${schedule}.`,
      relatedRecordId: batch.id,
      link: "/dashboard",
      email: {
        subject: "Your Swaraanjanam Class Schedule is Confirmed",
        heading: moved ? "Your class schedule has changed" : "Your class schedule is confirmed",
        intro: [moved ? "The academy has moved you to a different batch." : "The academy has assigned you to a batch. We look forward to seeing you in class!"],
        rows: [
          ["Course", batch.courseTitle],
          ["Previous batch", input.previousBatchName ?? null],
          ["Batch", batch.name],
          ["Teacher", batch.teacherName && batch.teacherName !== "Teacher" ? batch.teacherName : null],
          ["Class days and timings", schedule],
        ],
        outro: ["Your upcoming classes and Google Meet links appear on your student dashboard."],
        cta: { label: "Open your dashboard", url: dashboardUrl() },
      },
    });
  });
}

/** An individual (one-to-one) schedule was confirmed or changed by the academy. */
export async function notifyIndividualSchedule(registrationId: string, change: "confirmed" | "changed", previous: string | null = null): Promise<void> {
  await guarded("individual schedule", async () => {
    const snap = await col("registrations").doc(registrationId).get();
    const r = mapRegistration(snap);
    if (!r || !r.studentId || r.status !== "scheduled" || !r.confirmedSchedule) return;
    const changed = change === "changed";
    return notify({
      // A change is keyed by the registration's update time: each real change notifies once.
      eventKey: changed ? `schedule-changed:${registrationId}:${snap.updateTime?.toMillis() ?? r.updatedAt}` : `individual-scheduled:${registrationId}`,
      userId: r.studentId,
      type: changed ? "class_rescheduled" : "individual_scheduled",
      title: changed ? "Your class schedule has changed" : "Your class schedule is confirmed",
      message: changed
        ? `Your ${r.courseTitle} classes are now ${r.confirmedSchedule}${previous ? ` (previously ${previous})` : ""}.`
        : `Your individual ${r.courseTitle} classes are confirmed: ${r.confirmedSchedule}.`,
      relatedRecordId: registrationId,
      link: "/dashboard",
      email: {
        subject: changed ? "Your Swaraanjanam Class Schedule Has Changed" : "Your Swaraanjanam Class Schedule is Confirmed",
        heading: changed ? "Your class schedule has changed" : "Your class schedule is confirmed",
        intro: [changed ? "The academy has updated your individual class schedule." : "The academy has confirmed your individual class days and timings."],
        rows: [
          ["Student", learnerName(r)],
          ["Course", r.courseTitle],
          ["Enrolment type", ENROLMENT_TYPE_LABELS[r.enrolmentType]],
          ["Teacher", r.scheduleTeacherName || null],
          ["Previous schedule", changed ? previous : null],
          [changed ? "New schedule" : "Class days and timings", r.confirmedSchedule],
        ],
        outro: ["Your upcoming classes and Google Meet links appear on your student dashboard."],
        cta: { label: "Open your dashboard", url: dashboardUrl() },
      },
    });
  });
}

export interface ClassTarget {
  classId: string;
  studentId: string;
}

/** One class (or a batch session, one record per learner) moved to a new time. */
export async function notifyClassRescheduled(targets: ClassTarget[], info: { title: string; previous: { startAt: string; endAt: string }; next: { startAt: string; endAt: string } }): Promise<void> {
  await guarded("class rescheduled", async () => {
    const before = formatClassTime(info.previous.startAt, info.previous.endAt);
    const after = formatClassTime(info.next.startAt, info.next.endAt);
    const outcomes: NotifyOutcome[] = [];
    for (const t of uniqueByStudent(targets)) {
      // Keyed by the class record's update time: each real move notifies once (moving back and forth included).
      const cls = await col("liveClasses").doc(t.classId).get();
      if (!cls.exists || cls.get("status") !== "scheduled") continue;
      outcomes.push(
        await notify({
          eventKey: `class-rescheduled:${t.classId}:${cls.updateTime?.toMillis() ?? info.next.startAt}`,
          userId: t.studentId,
          type: "class_rescheduled",
          title: "Class rescheduled",
          message: `“${info.title}” has moved from ${before} to ${after}.`,
          relatedRecordId: t.classId,
          link: "/dashboard",
          email: {
            subject: "Class Rescheduled — Swaraanjanam",
            heading: "Your class has been rescheduled",
            intro: [`The academy has moved “${info.title}”.`],
            rows: [
              ["Previous schedule", before],
              ["New schedule", after],
            ],
            cta: { label: "View your classes", url: dashboardUrl() },
          },
        }),
      );
    }
    return outcomes;
  });
}

export async function notifyClassCancelled(targets: ClassTarget[], info: { title: string; startAt: string; endAt: string; kind: "academy" | "student" | "rescheduled"; reason: string | null }): Promise<void> {
  await guarded("class cancelled", async () => {
    const when = formatClassTime(info.startAt, info.endAt);
    const by = info.kind === "student" ? "at your request" : info.kind === "rescheduled" ? "to be rescheduled" : "by the academy";
    const outcomes: NotifyOutcome[] = [];
    for (const t of uniqueByStudent(targets)) {
      outcomes.push(
        await notify({
          eventKey: `class-cancelled:${t.classId}`,
          userId: t.studentId,
          type: "class_cancelled",
          title: "Class cancelled",
          message: `“${info.title}” on ${when} was cancelled ${by}.${info.reason ? ` ${info.reason}` : ""}`,
          relatedRecordId: t.classId,
          link: "/dashboard",
          email: {
            subject: "Class Cancelled — Swaraanjanam",
            heading: "A class has been cancelled",
            intro: [`“${info.title}” has been cancelled ${by}.`],
            rows: [
              ["Previous schedule", when],
              ["New schedule", info.kind === "rescheduled" ? "The academy will share the new time on your dashboard" : null],
              ["Reason", info.reason],
            ],
            cta: { label: "View your classes", url: dashboardUrl() },
          },
        }),
      );
    }
    return outcomes;
  });
}

/** A class recording was added (or replaced) for the learners of that class. */
export async function notifyRecordingAvailable(targets: (ClassTarget & { accountId: string | null })[], info: { title: string; date: string; videoId: string }): Promise<void> {
  await guarded("recording", async () => {
    const outcomes: NotifyOutcome[] = [];
    for (const t of uniqueByStudent(targets)) {
      const account = t.accountId ? await col("billingAccounts").doc(t.accountId).get() : null;
      const courseId = account?.exists ? String(account.get("courseId") ?? "") : "";
      outcomes.push(
        await notify({
          eventKey: `recording:${t.classId}:${info.videoId}`,
          userId: t.studentId,
          type: "recording_available",
          title: "New class recording available",
          message: `The recording of “${info.title}” (${istDate(`${info.date}T12:00:00+05:30`) ?? info.date}) is ready to watch.`,
          relatedRecordId: t.classId,
          link: courseId ? `/dashboard/courses/${courseId}` : "/dashboard",
          email: {
            subject: "New Class Recording Available — Swaraanjanam",
            heading: "Your class recording is ready",
            intro: [`The recording of “${info.title}” is now available on your student dashboard.`],
            rows: [
              ["Class", info.title],
              ["Class date", istDate(`${info.date}T12:00:00+05:30`) ?? info.date],
            ],
            cta: { label: "Watch the recording", url: dashboardUrl(courseId ? `/dashboard/courses/${courseId}` : "/dashboard") },
          },
        }),
      );
    }
    return outcomes;
  });
}

function uniqueByStudent<T extends ClassTarget>(targets: T[]): T[] {
  const seen = new Set<string>();
  return targets.filter((t) => t.studentId && !seen.has(t.studentId) && seen.add(t.studentId));
}
