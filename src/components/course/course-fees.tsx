import { Check, User, Users, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FEE_TERMS, type PublicCourseFees } from "@/lib/catalog/public-pricing";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

// The academy's per-session fees, rendered from the billing rates in force.
// One component for the homepage "Courses & fees" section and course pages,
// so the wording and amounts can never drift apart.

/** Compact fee line for a course card. */
export function CourseFeeLine({ fee, className }: { fee: PublicCourseFees | null; className?: string }) {
  if (!fee) {
    return <p className={cn("font-heading text-lg font-semibold text-brown-muted", className)}>Fees to be announced</p>;
  }
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className="font-heading text-2xl font-bold text-maroon">{formatMoney(fee.batchMinor)}</span>
      <span className="text-sm text-muted-foreground">per session · batch</span>
      <span className="w-full text-xs text-muted-foreground">Individual {formatMoney(fee.individualMinor)} per session</span>
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

/** The fee options billing can actually charge (the sibling discount only once billing applies it). */
export function feeOptions(fee: PublicCourseFees): FeeOption[] {
  return [
    { key: "batch", icon: Users, title: "Batch class", amountMinor: fee.batchMinor, unit: "per session, per student", note: "Small batches of up to 5 students" },
    { key: "individual", icon: User, title: "Individual class", amountMinor: fee.individualMinor, unit: "per session", note: "One-to-one with the teacher" },
    ...(fee.siblingDiscount
      ? [
          {
            key: "sibling",
            icon: UsersRound,
            title: "Siblings / two learners on one device",
            amountMinor: fee.siblingDiscount.batchMinor,
            unit: "per learner, per batch session",
            note: `${fee.siblingDiscount.percent}% off the batch fee of ${formatMoney(fee.batchMinor)}`,
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
      <ul className={cn("grid gap-4", options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
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
