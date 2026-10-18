"use client";

import { IndianRupee, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { recordPayment, updateEnrollmentFee, updatePaymentStatus } from "@/app/(account)/teacher/payment-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_TRANSITIONS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/lms/types";

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function todayInIndia() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function VerifiedCheckbox({ id, error }: { id: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gold/40 bg-gold-soft/40 p-3">
      <div className="flex items-start gap-3">
        <input id={id} name="verifiedConfirmation" type="checkbox" className="mt-0.5 size-4 accent-maroon" />
        <Label htmlFor={id} className="text-sm leading-snug font-normal text-brown">
          I have verified that this money was actually received (bank statement, UPI history or cash in hand).
        </Label>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function RecordPaymentDialog({
  enrollmentOptions,
  packageOptions = [],
  methods = [...PAYMENT_METHODS],
  defaultTarget,
  triggerLabel = "Record payment",
}: {
  /** Legacy enrollment fees. */
  enrollmentOptions: { id: string; label: string }[];
  /** Packages (preferred for new billing). */
  packageOptions?: { id: string; label: string }[];
  /** The academy's accepted methods (teacher settings). */
  methods?: PaymentMethod[];
  /** "package:<id>" or "enrollment:<id>". */
  defaultTarget?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>("paid");
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  const empty = enrollmentOptions.length === 0 && packageOptions.length === 0;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          reset();
          setStatus("paid");
        }
        setOpen(next);
      }}
      className="sm:max-w-lg"
      trigger={
        <Button type="button" size="sm" disabled={empty || methods.length === 0}>
          <Plus data-icon="inline-start" />
          {triggerLabel}
        </Button>
      }
      title="Record an offline payment"
      description="For payments received outside the website. Only payments that are paid and verified count as received."
    >
      <form
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const [kind, id] = String(data.get("target") ?? "").split(":");
          run(
            () =>
              recordPayment({
                packageId: kind === "package" ? id : undefined,
                enrollmentId: kind === "enrollment" ? id : undefined,
                amount: data.get("amount"),
                method: data.get("method"),
                reference: data.get("reference"),
                paidAt: data.get("paidAt"),
                status: data.get("status"),
                notes: data.get("notes"),
                payerName: data.get("payerName"),
                rejectionReason: data.get("rejectionReason"),
                verifiedConfirmation: data.get("verifiedConfirmation") === "on",
              }),
            { onSuccess: () => setOpen(false) },
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field id="pay-target" label="Package or course fee" error={e.target}>
            <NativeSelect id="pay-target" name="target" defaultValue={defaultTarget ?? ""} required>
              <option value="">Choose…</option>
              {packageOptions.length > 0 && (
                <optgroup label="Packages">
                  {packageOptions.map((o) => (
                    <option key={o.id} value={`package:${o.id}`}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {enrollmentOptions.length > 0 && (
                <optgroup label="Course fees (earlier enrollments)">
                  {enrollmentOptions.map((o) => (
                    <option key={o.id} value={`enrollment:${o.id}`}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pay-amount" label="Amount (₹)" error={e.amount}>
              <Input id="pay-amount" name="amount" inputMode="decimal" placeholder="e.g. 1600" required aria-invalid={e.amount ? true : undefined} />
            </Field>
            <Field id="pay-date" label="Payment date" error={e.paidAt}>
              <Input id="pay-date" name="paidAt" type="date" defaultValue={todayInIndia()} max={todayInIndia()} required />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pay-method" label="Method" error={e.method}>
              <NativeSelect id="pay-method" name="method" defaultValue={methods[0]}>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="pay-status" label="Status" error={e.status}>
              <NativeSelect id="pay-status" name="status" value={status} onChange={(ev) => setStatus(ev.target.value as PaymentStatus)}>
                <option value="paid">Paid — verified now</option>
                <option value="pending">Pending — verify later</option>
                <option value="failed">Failed / rejected</option>
              </NativeSelect>
            </Field>
          </div>
          <Field id="pay-ref" label="Transaction / reference ID" error={e.reference} hint="UPI reference, bank UTR, receipt number … Each reference can be recorded only once.">
            <Input id="pay-ref" name="reference" maxLength={100} autoComplete="off" />
          </Field>
          <Field id="pay-payer" label="Paid by (optional)" hint="If someone other than the learner paid, e.g. a parent. Shown on the receipt.">
            <Input id="pay-payer" name="payerName" maxLength={120} autoComplete="off" />
          </Field>
          {status === "failed" && (
            <Field id="pay-reject" label="Reason (required)" error={e.rejectionReason}>
              <Input id="pay-reject" name="rejectionReason" maxLength={300} required />
            </Field>
          )}
          <Field id="pay-notes" label="Notes" hint="Optional. Visible only to teachers.">
            <Textarea id="pay-notes" name="notes" maxLength={500} rows={2} className="min-h-16" />
          </Field>
          {status === "paid" && <VerifiedCheckbox id="pay-verified" error={e.verifiedConfirmation} />}
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner className="size-4 text-cream" /> : <IndianRupee data-icon="inline-start" />}
            Save payment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const TRANSITION_LABELS: Record<PaymentStatus, string> = {
  paid: "Verify payment",
  failed: "Reject",
  pending: "Reopen as pending",
  refunded: "Record full refund",
};

export function PaymentStatusActions({ paymentId, status, source }: { paymentId: string; status: PaymentStatus; source: "manual" | "gateway" }) {
  const [target, setTarget] = useState<PaymentStatus | null>(null);
  const { pending, error, fieldErrors, run, reset } = useServerAction();
  const options = source === "gateway" ? [] : PAYMENT_TRANSITIONS[status];
  if (options.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            variant={option === "paid" ? "outline" : "ghost"}
            size="sm"
            className={option === "refunded" || option === "failed" ? "text-destructive" : undefined}
            onClick={() => {
              reset();
              setTarget(option);
            }}
          >
            {TRANSITION_LABELS[option]}
          </Button>
        ))}
      </div>
      <Modal
        open={target !== null}
        onOpenChange={(next) => {
          if (!next && !pending) setTarget(null);
        }}
        className="sm:max-w-md"
        title={target ? `${TRANSITION_LABELS[target]}?` : ""}
        description="The change is recorded in the payment’s history with your name and the time."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(() => updatePaymentStatus(paymentId, target, data.get("note"), data.get("verifiedConfirmation") === "on"), {
              onSuccess: () => setTarget(null),
            });
          }}
        >
          <Field
            id={`note-${paymentId}`}
            label={target === "refunded" ? "Refund note (required)" : target === "failed" ? "Reason for rejecting (required)" : "Note (optional)"}
            error={fieldErrors.note}
          >
            <Input id={`note-${paymentId}`} name="note" maxLength={300} required={target === "refunded" || target === "failed"} />
          </Field>
          {target === "paid" && <VerifiedCheckbox id={`verify-${paymentId}`} />}
          {error && <FormAlert tone="error">{error}</FormAlert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={target === "refunded" || target === "failed" ? "destructive" : "default"} disabled={pending}>
              {pending && <Spinner className="size-4 text-current" />}
              Confirm
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function EditFeeDialog({ enrollmentId, feeRupees, courseTitle }: { enrollmentId: string; feeRupees: number | null; courseTitle: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-md"
      trigger={
        <Button type="button" variant="ghost" size="sm" aria-label={`Edit agreed fee for ${courseTitle}`}>
          <Pencil />
        </Button>
      }
      title="Edit agreed fee"
      description={`The fee this student agreed to pay for “${courseTitle}”. It does not change the public course price.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run(() => updateEnrollmentFee(enrollmentId, data.get("fee"), data.get("reason")), { onSuccess: () => setOpen(false) });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field id={`fee-${enrollmentId}`} label="Agreed fee (₹, whole rupees)" error={e.fee} hint="Leave empty if no fee applies.">
            <Input id={`fee-${enrollmentId}`} name="fee" inputMode="numeric" defaultValue={feeRupees ?? ""} />
          </Field>
          <Field id={`reason-${enrollmentId}`} label="Reason" error={e.reason}>
            <Input id={`reason-${enrollmentId}`} name="reason" maxLength={200} placeholder="e.g. Sibling discount" required />
          </Field>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Save fee
          </Button>
        </div>
      </form>
    </Modal>
  );
}
