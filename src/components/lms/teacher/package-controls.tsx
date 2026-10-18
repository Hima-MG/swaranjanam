"use client";

import { Ban, PackagePlus, PlayCircle, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { activatePackage, cancelPackage, createPackage, recordAdjustment } from "@/app/(account)/teacher/billing-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import {
  ADJUSTMENT_KIND_LABELS,
  ADJUSTMENT_KINDS,
  LEARNER_CATEGORIES,
  LEARNER_CATEGORY_LABELS,
  PLAN_STATUS_LABELS,
  quotePackage,
  type AdjustmentKind,
  type LearnerCategory,
  type PackageType,
  type PricePlan,
} from "@/lib/lms/billing";

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

function newRequestKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Assign a regular, pair or program package. The price shown here is a
 * preview from the same rules the server uses; the server recalculates it from
 * the stored plan and ignores anything the browser could send.
 */
export function AssignPackageDialog({
  plans,
  students,
  defaultStudentId,
}: {
  plans: PricePlan[];
  students: { uid: string; label: string }[];
  defaultStudentId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [planId, setPlanId] = useState("");
  const [pair, setPair] = useState(false);
  const [categories, setCategories] = useState<[LearnerCategory | "", LearnerCategory | ""]>(["", ""]);
  const { pending, error, fieldErrors: e, run, reset, success } = useServerAction();

  const plan = plans.find((p) => p.id === planId) ?? null;
  const type: PackageType = plan?.kind === "program" ? "program" : pair ? "pair" : "regular";
  const chosen = (pair ? categories : [categories[0]]).filter((c): c is LearnerCategory => c !== "");
  const quote = plan && chosen.length === (pair ? 2 : 1) ? quotePackage(plan, type, chosen) : null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          reset();
          setRequestKey(newRequestKey());
          setPlanId("");
          setPair(false);
          setCategories(["", ""]);
        }
        setOpen(next);
      }}
      className="sm:max-w-xl"
      trigger={
        <Button type="button" size="sm" disabled={students.length === 0}>
          <PackagePlus data-icon="inline-start" />
          Assign package
        </Button>
      }
      title="Assign a package"
      description="The package starts as awaiting payment. It becomes active automatically once verified payments cover the fee."
    >
      <form
        className="-mx-1 flex max-h-[72vh] flex-col gap-4 overflow-y-auto px-1 pb-1"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          const learners = [{ studentId: d.get("student0"), category: d.get("category0") }];
          if (type === "pair") learners.push({ studentId: d.get("student1"), category: d.get("category1") });
          run(
            () =>
              createPackage({
                requestKey,
                planId: d.get("planId"),
                type,
                learners,
                startDate: d.get("startDate"),
                notes: d.get("notes"),
                confirmationReason: d.get("confirmationReason"),
              }),
            {
              onSuccess: (data) => {
                setOpen(false);
                router.push(`/teacher/packages/${data.packageId}`);
              },
            },
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field id="pkg-plan" label="Course or program" error={e.planId}>
            <NativeSelect id="pkg-plan" name="planId" value={planId} onChange={(ev) => setPlanId(ev.target.value)} required>
              <option value="">Choose…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id} disabled={p.status !== "active"}>
                  {p.title}
                  {p.status !== "active" ? ` (${PLAN_STATUS_LABELS[p.status]})` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {plan?.kind === "regular" && plan.pairEligible && (
            <label className="flex items-center gap-3 text-sm text-brown">
              <input type="checkbox" checked={pair} onChange={(ev) => setPair(ev.target.checked)} className="size-4 accent-maroon" />
              Pair plan — two learners who enrol and pay together
            </label>
          )}

          {(pair && type === "pair" ? [0, 1] : [0]).map((i) => (
            <div key={i} className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-[3fr_2fr]">
              <Field id={`pkg-student${i}`} label={type === "pair" ? `Learner ${i + 1}` : "Learner"} error={e[`student${i}`]}>
                <NativeSelect id={`pkg-student${i}`} name={`student${i}`} defaultValue={i === 0 ? (defaultStudentId ?? "") : ""} required>
                  <option value="">Choose a student…</option>
                  {students.map((s) => (
                    <option key={s.uid} value={s.uid}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`pkg-category${i}`} label="Fee category" error={e[`category${i}`]}>
                <NativeSelect
                  id={`pkg-category${i}`}
                  name={`category${i}`}
                  value={categories[i]}
                  onChange={(ev) => {
                    const next = [...categories] as typeof categories;
                    next[i] = ev.target.value as LearnerCategory | "";
                    setCategories(next);
                  }}
                  required
                >
                  <option value="">Choose…</option>
                  {LEARNER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {LEARNER_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ))}

          {quote && (
            <div className="rounded-xl border border-gold/40 bg-gold-soft/40 p-4 text-sm text-brown" role="status">
              {quote.ok ? (
                <>
                  <p>
                    Fee: <span className="font-semibold">{formatMoney(quote.priceMinor)}</span> for {quote.sessionsIncluded} session
                    {quote.sessionsIncluded === 1 ? "" : "s"}
                    {type === "program" ? " (one-time)" : ""}.
                  </p>
                  {quote.needsConfirmation && <p className="mt-2">{quote.needsConfirmation}</p>}
                </>
              ) : (
                <p className="text-destructive">{quote.error}</p>
              )}
            </div>
          )}

          {quote?.ok && quote.needsConfirmation && (
            <Field id="pkg-confirm" label="Confirmation reason (required)" error={e.confirmationReason}>
              <Input id="pkg-confirm" name="confirmationReason" maxLength={300} placeholder="e.g. Parent learns with their child on one device" required />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pkg-start" label="Start date (optional)" error={e.startDate}>
              <Input id="pkg-start" name="startDate" type="date" />
            </Field>
          </div>
          <Field id="pkg-notes" label="Notes (optional, teachers only)">
            <Textarea id="pkg-notes" name="notes" maxLength={500} rows={2} className="min-h-16" />
          </Field>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {success && <FormAlert tone="success">{success}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !quote?.ok}>
            {pending && <Spinner className="size-4 text-cream" />}
            Assign package
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReasonDialog({
  trigger,
  title,
  description,
  label,
  required,
  confirmLabel,
  destructive,
  action,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  label: string;
  required: boolean;
  confirmLabel: string;
  destructive?: boolean;
  action: (reason: FormDataEntryValue | null) => ReturnType<typeof cancelPackage>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, run, reset } = useServerAction();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-md"
      trigger={trigger}
      title={title}
      description={description}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const reason = new FormData(event.currentTarget).get("reason");
          run(() => action(reason), { onSuccess: () => setOpen(false) });
        }}
      >
        <Field id="reason-input" label={label} error={fieldErrors.reason}>
          <Input id="reason-input" name="reason" maxLength={300} required={required} disabled={pending} />
        </Field>
        {error && !fieldErrors.reason && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Back
          </Button>
          <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
            {pending && <Spinner className="size-4 text-current" />}
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ActivatePackageDialog({ packageId, balanceMinor }: { packageId: string; balanceMinor: number }) {
  const unpaid = balanceMinor > 0;
  return (
    <ReasonDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <PlayCircle data-icon="inline-start" />
          Activate
        </Button>
      }
      title="Activate this package?"
      description={
        unpaid
          ? `${formatMoney(balanceMinor)} is still unpaid. Activating now is an exception: your reason and the unpaid amount are recorded in the package history and activity log.`
          : "The package is fully paid."
      }
      label={unpaid ? "Reason for activating before full payment (required)" : "Note (optional)"}
      required={unpaid}
      confirmLabel="Activate"
      action={(reason) => activatePackage(packageId, reason)}
    />
  );
}

export function CancelPackageDialog({ packageId, title }: { packageId: string; title: string }) {
  return (
    <ReasonDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          <Ban data-icon="inline-start" />
          Cancel package
        </Button>
      }
      title="Cancel this package?"
      description={`“${title}” will no longer be available for scheduling. Payments are not changed; record any approved refund separately.`}
      label="Reason (required)"
      required
      confirmLabel="Cancel package"
      destructive
      action={(reason) => cancelPackage(packageId, reason)}
    />
  );
}

export function AdjustmentDialog({ packageId, refundablePayments }: { packageId: string; refundablePayments: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AdjustmentKind>("waiver");
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          reset();
          setKind("waiver");
        }
        setOpen(next);
      }}
      className="sm:max-w-md"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <SlidersHorizontal data-icon="inline-start" />
          Record adjustment
        </Button>
      }
      title="Record an approved adjustment"
      description="Adjustments are permanent records with your name and reason. There is no automatic refund for unused classes; record only what was approved."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          run(
            () =>
              recordAdjustment(packageId, {
                kind,
                amount: d.get("amount"),
                credits: d.get("credits"),
                paymentId: d.get("paymentId"),
                reason: d.get("reason"),
              }),
            { onSuccess: () => setOpen(false) },
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field id="adj-kind" label="Type" error={e.kind}>
            <NativeSelect id="adj-kind" value={kind} onChange={(ev) => setKind(ev.target.value as AdjustmentKind)}>
              {ADJUSTMENT_KINDS.map((k) => (
                <option key={k} value={k} disabled={k === "refund" && refundablePayments.length === 0}>
                  {ADJUSTMENT_KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {kind === "refund" && (
            <Field id="adj-payment" label="Payment being refunded" error={e.paymentId}>
              <NativeSelect id="adj-payment" name="paymentId" required>
                <option value="">Choose…</option>
                {refundablePayments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {kind === "credit" ? (
            <Field id="adj-credits" label="Classes to add (+) or remove (−)" error={e.credits} hint="e.g. 1 to add a make-up class, -1 to remove one.">
              <Input id="adj-credits" name="credits" inputMode="numeric" required />
            </Field>
          ) : (
            <Field id="adj-amount" label="Amount (₹)" error={e.amount}>
              <Input id="adj-amount" name="amount" inputMode="decimal" required />
            </Field>
          )}
          <Field id="adj-reason" label="Reason and approval (required)" error={e.reason}>
            <Input id="adj-reason" name="reason" maxLength={300} required />
          </Field>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Save adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
