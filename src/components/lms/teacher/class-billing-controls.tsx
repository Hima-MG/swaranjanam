"use client";

import { BadgeCheck, FilePlus2, Lock, PlayCircle, ShieldCheck, SlidersHorizontal, UserPlus } from "lucide-react";

import {
  addRateVersion,
  applyAdvanceToInvoice,
  closeBillingAccount,
  openIndividualAccount,
  recordInvoiceAdjustment,
  runBillingNow,
  updateClassBillingPolicy,
  verifyLegacyDues,
} from "@/app/(account)/teacher/class-billing-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { ActionDialog, Field } from "@/components/lms/teacher/batch-controls";
import { useServerAction } from "@/components/lms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { BillingPolicy } from "@/lib/lms/class-billing";

export function RunBillingButton() {
  const { pending, error, success, run } = useServerAction();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(() => runBillingNow(), {
            success: (d) => `Billing run finished: ${d.created} invoice(s) created, ${d.suspended} suspended, ${d.restored} restored${d.errors ? `, ${d.errors} error(s) — see server logs` : ""}.`,
          })
        }
      >
        {pending ? <Spinner className="size-4 text-current" /> : <PlayCircle data-icon="inline-start" />}
        Run billing now
      </Button>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
    </div>
  );
}

export function ApplyAdvanceButton({ invoiceId }: { invoiceId: string }) {
  return (
    <ActionDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <BadgeCheck data-icon="inline-start" />
          Apply advance
        </Button>
      }
      title="Apply the unused advance to this invoice?"
      description="Uses the verified enrolment advance that has not been applied yet (up to the invoice balance). Recorded in the advance ledger; it can never be applied twice."
      confirmLabel="Apply advance"
      action={() => applyAdvanceToInvoice(invoiceId)}
    />
  );
}

export function InvoiceAdjustmentDialog({ invoiceId }: { invoiceId: string }) {
  return (
    <ActionDialog
      trigger={
        <Button type="button" variant="ghost" size="sm">
          <FilePlus2 data-icon="inline-start" />
          Credit / debit note
        </Button>
      }
      title="Record a correction"
      description="Issued invoices are never edited. A credit note reduces what is owed; a debit note increases it. Both are permanent records with your name."
      label="Reason and approval (required)"
      required
      confirmLabel="Save note"
      action={(d) => recordInvoiceAdjustment(invoiceId, d.get("kind"), d.get("amount"), d.get("reason"))}
    >
      <Field id="adj-kind" label="Type">
        <NativeSelect id="adj-kind" name="kind" defaultValue="credit_note">
          <option value="credit_note">Credit note (reduce amount due)</option>
          <option value="debit_note">Debit note (increase amount due)</option>
        </NativeSelect>
      </Field>
      <Field id="adj-amount" label="Amount (₹)">
        <Input id="adj-amount" name="amount" inputMode="decimal" required />
      </Field>
    </ActionDialog>
  );
}

export function CloseAccountDialog({ accountId, name }: { accountId: string; name: string }) {
  return (
    <ActionDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          <Lock data-icon="inline-start" />
          Close account
        </Button>
      }
      title={`Close ${name}'s billing account?`}
      description="For a student leaving the course. All history is kept; charges already recorded are still invoiced. No refund of an unused advance is made automatically."
      label="Reason (required)"
      required
      confirmLabel="Close account"
      destructive
      action={(d) => closeBillingAccount(accountId, d.get("reason"))}
    />
  );
}

export function OpenIndividualAccountDialog({ students, courses }: { students: { uid: string; label: string }[]; courses: { id: string; title: string }[] }) {
  return (
    <ActionDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <UserPlus data-icon="inline-start" />
          Individual sessions
        </Button>
      }
      title="Open individual one-to-one sessions for a student"
      description="₹750 per session, each paid separately. Old dues (before November 2026) must be verified first."
      confirmLabel="Open account"
      action={(d) => openIndividualAccount(d.get("studentId"), d.get("courseId"))}
    >
      <Field id="ind-student" label="Student">
        <NativeSelect id="ind-student" name="studentId" defaultValue="">
          <option value="">Choose…</option>
          {students.map((s) => (
            <option key={s.uid} value={s.uid}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="ind-course" label="Course (the student must be enrolled)">
        <NativeSelect id="ind-course" name="courseId" defaultValue="">
          <option value="">Choose…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </ActionDialog>
  );
}

/** Administrator verification of fees before November 2026 (paid outside the website). */
export function LegacyDuesForm({ studentId, current }: { studentId: string; current: string | null }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget);
        run(() => verifyLegacyDues(studentId, d.get("status"), d.get("note")), { success: "Old dues verification recorded." });
      }}
    >
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field id="ld-status" label="Verification" error={e.status}>
          <NativeSelect id="ld-status" name="status" defaultValue={current ?? "cleared"}>
            <option value="cleared">All fees up to October 2026 are cleared</option>
            <option value="no_previous_dues">No fees before November 2026 (new student)</option>
          </NativeSelect>
        </Field>
        <Field id="ld-note" label="How was this checked? (required)" error={e.note}>
          <Textarea id="ld-note" name="note" maxLength={300} rows={2} className="min-h-16" placeholder="e.g. Checked the October 2026 UPI ledger; last payment ref ending 4321" />
        </Field>
      </fieldset>
      {error && !Object.keys(e).length && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? <Spinner className="size-4 text-cream" /> : <ShieldCheck data-icon="inline-start" />}
        Record verification
      </Button>
    </form>
  );
}

const Pending = () => <Badge variant="outline">Pending academy decision</Badge>;

export function PolicyForm({ policy }: { policy: BillingPolicy }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget);
        run(() => updateClassBillingPolicy({ batchStudentCancelled: d.get("batchStudentCancelled"), advanceBeforeScheduling: d.get("advanceBeforeScheduling") === "on" }), {
          success: "Policy saved.",
        });
      }}
    >
      <fieldset disabled={pending} className="flex flex-col gap-5">
        <Field id="p-student" label="Batch class cancelled by the student" error={e.batchStudentCancelled}>
          <NativeSelect id="p-student" name="batchStudentCancelled" defaultValue={policy.batchStudentCancelled}>
            <option value="not_billable">Not billed</option>
            <option value="billable">Billed (₹400)</option>
          </NativeSelect>
          <Pending />
        </Field>
        <label className="flex items-start gap-3 text-sm text-brown">
          <input type="checkbox" name="advanceBeforeScheduling" defaultChecked={policy.advanceBeforeScheduling} className="mt-0.5 size-4 accent-maroon" />
          <span>
            Require a verified ₹400 advance before a student&apos;s batch classes can be scheduled <Pending />
          </span>
        </label>
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? <Spinner className="size-4 text-cream" /> : <SlidersHorizontal data-icon="inline-start" />}
        Save policy
      </Button>
    </form>
  );
}

export function RateVersionForm({ minMonth }: { minMonth: string }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget);
        run(() => addRateVersion(Object.fromEntries(d.entries())), { success: "New rates saved. They apply to every student from the chosen month." });
      }}
    >
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-4">
        <Field id="r-from" label="Applies from (month)" error={e.effectiveFrom}>
          <Input id="r-from" name="effectiveFrom" type="month" min={minMonth} defaultValue={minMonth} required />
        </Field>
        <Field id="r-batch" label="Batch ₹/class/student" error={e.batch}>
          <Input id="r-batch" name="batch" inputMode="numeric" defaultValue="400" />
        </Field>
        <Field id="r-ind" label="Individual ₹/session" error={e.individual}>
          <Input id="r-ind" name="individual" inputMode="numeric" defaultValue="750" />
        </Field>
        <Field id="r-adv" label="Batch enrolment advance ₹" error={e.advance}>
          <Input id="r-adv" name="advance" inputMode="numeric" defaultValue="400" />
        </Field>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        A new rate starts on the 1st of a future month and applies to all students. Charges already recorded and invoices already issued keep their rates.
      </p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" variant="outline" className="self-start" disabled={pending}>
        {pending && <Spinner className="size-4 text-current" />}
        Save new rates
      </Button>
    </form>
  );
}
