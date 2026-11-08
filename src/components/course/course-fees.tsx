import type { PublicProgramme } from "@/lib/lms/programme";
import { Check, User, Users, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FEE_TERMS, type PublicCourseFees } from "@/lib/catalog/public-pricing";
import { formatMoney } from "@/lib/format";
import { SHARED_RATES } from "@/lib/lms/registration";
import { cn } from "@/lib/utils";

// A course's own per-class / per-session rates (only the class types it
// offers). One component for the homepage "Courses & fees" section and course
// pages, so the wording and amounts can never drift apart. Never a course total.

/** Compact fee line for a course card. */
export function CourseFeeLine({ fee, programme, className }: { fee: PublicCourseFees | null; programme?: PublicProgramme | null; className?: string }) {
  if (programme) {
    return (
      <p className={cn("flex flex-wrap items-baseline gap-x-1.5", className)}>
        <span className="font-heading text-2xl font-bold text-maroon">{formatMoney(programme.feeMinor)}</span>
        <span className="text-sm text-muted-foreground">total · Special Programme</span>
        <span className="w-full text-xs text-muted-foreground">
          {programme.startDate} to {programme.endDate} · one full payment, no monthly invoice
        </span>
      </p>
    );
  }
  if (!fee || (fee.batchMinor === null && fee.individualMinor === null)) {
    return <p className={cn("font-heading text-lg font-semibold text-brown-muted", className)}>Fees to be announced</p>;
  }
  const [main, unit, other] =
    fee.batchMinor !== null
      ? [fee.batchMinor, "per class · batch", fee.individualMinor !== null ? `Individual ${formatMoney(fee.individualMinor)} per session` : "Batch classes only"]
      : [fee.individualMinor!, "per session · individual", "Individual classes only"];
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className="font-heading text-2xl font-bold text-maroon">{formatMoney(main)}</span>
      <span className="text-sm text-muted-foreground">{unit}</span>
      <span className="w-full text-xs text-muted-foreground">{other}</span>
    </p>
  );
}

interface FeeOption {
  key: string;
  icon: LucideIcon;
  title: string;
  amountMinor: number;
  unit: string;
  note: string;
}

/** The fee options billing can actually charge, for the class types offered (the sibling discount only once billing applies it). */
export function feeOptions(fee: PublicCourseFees): FeeOption[] {
  return [
    ...(fee.batchMinor !== null
      ? [{ key: "batch", icon: Users, title: "Batch class", amountMinor: fee.batchMinor, unit: "per class, per student", note: "Small batches of up to 5 students" }]
      : []),
    ...(fee.individualMinor !== null
      ? [{ key: "individual", icon: User, title: "Individual class", amountMinor: fee.individualMinor, unit: "per session", note: "One-to-one with the teacher" }]
      : []),
    // Learn Together: two learners under one login (fixed academy rates, per person per session).
    ...(fee.batchMinor !== null
      ? [
          {
            key: "shared_batch",
            icon: UsersRound,
            title: "Learn Together – batch",
            amountMinor: SHARED_RATES.batchMinor,
            unit: "per person, per session",
            note: `Two learners, one login: ${formatMoney(SHARED_RATES.batchMinor * 2)} per session for both`,
          },
        ]
      : []),
    ...(fee.individualMinor !== null
      ? [
          {
            key: "shared_individual",
            icon: UsersRound,
            title: "Learn Together – one-to-one",
            amountMinor: SHARED_RATES.individualMinor,
            unit: "per person, per session",
            note: `Two learners, one login: ${formatMoney(SHARED_RATES.individualMinor * 2)} per session for both`,
          },
        ]
      : []),
  ];
}

/** All fee options and how payment works. `headingLevel` keeps the page outline correct. */
export function FeeSummary({ fee, headingLevel = 3, className }: { fee: PublicCourseFees; headingLevel?: 2 | 3; className?: string }) {
  const Heading = `h${headingLevel}` as const;
  const options = feeOptions(fee);
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <ul className={cn("grid gap-4", options.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map(({ key, icon: Icon, title, amountMinor, unit, note }) => (
          <li key={key} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-soft">
            <span className="flex size-10 items-center justify-center rounded-full bg-maroon-soft text-maroon">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <Heading className="font-heading text-lg font-semibold text-brown">{title}</Heading>
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-heading text-3xl font-bold text-maroon">{formatMoney(amountMinor)}</span>
              <span className="text-sm text-muted-foreground">{unit}</span>
            </p>
            <p className="text-sm text-muted-foreground">{note}</p>
          </li>
        ))}
      </ul>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="How fees work">
        {FEE_TERMS.map((term) => (
          <li key={term} className="flex items-start gap-2 text-sm text-brown">
            <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
            {term}
          </li>
        ))}
      </ul>
    </div>
  );
}
