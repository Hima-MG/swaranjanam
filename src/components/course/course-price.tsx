import { formatMoney } from "@/lib/format";
import { feeHeadline, type PublicFee } from "@/lib/catalog/public-fees";
import { cn } from "@/lib/utils";

interface CoursePriceProps {
  /** Fees from the linked published fee plan; null shows "Fees on request". */
  fee: PublicFee | null;
  size?: "sm" | "lg";
  /** Course page: list every published fee (adult, student, pair) instead of the headline only. */
  detailed?: boolean;
  className?: string;
}

const PAIR_LABELS = { two_adults: "2 adults", adult_student: "1 adult + 1 student", two_students: "2 students" } as const;

/** Course fee, taken only from the academy's published fee plans. No discounts are shown. */
export function CoursePrice({ fee, size = "sm", detailed = false, className }: CoursePriceProps) {
  if (!fee) {
    return (
      <p className={cn("font-heading font-semibold text-maroon", size === "sm" ? "text-lg" : "text-2xl", className)}>
        Fees on request
      </p>
    );
  }
  const headline = feeHeadline(fee);
  const comingSoon = fee.status === "coming_soon";
  const packageNote =
    fee.kind === "program"
      ? `One-time fee · ${fee.durationWeeks ? `${fee.durationWeeks} weeks` : `${fee.sessionsIncluded} sessions`}${fee.sessionsPerWeek === 1 ? ", once a week" : ""}`
      : `Package of ${fee.sessionsIncluded} live class${fee.sessionsIncluded === 1 ? "" : "es"}, paid in advance`;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {comingSoon && <span className="text-xs font-semibold tracking-wide text-gold uppercase">Coming soon</span>}
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {headline.from && <span className="text-sm text-muted-foreground">From</span>}
        <span className={cn("font-heading font-bold text-maroon", size === "sm" ? "text-2xl" : "text-4xl")}>
          {formatMoney(headline.amountMinor)}
        </span>
        <span className="text-sm text-muted-foreground">{headline.unit}</span>
      </p>

      {detailed && (
        <>
          <p className="text-xs text-muted-foreground">{packageNote}</p>
          {fee.kind === "regular" && (
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {fee.adultPriceMinor !== null && (
                <>
                  <dt className="text-muted-foreground">Adults (16 years and above)</dt>
                  <dd className="text-right font-medium text-brown">{formatMoney(fee.adultPriceMinor)}</dd>
                </>
              )}
              {fee.studentPriceMinor !== null && (
                <>
                  <dt className="text-muted-foreground">Students (15 years and below)</dt>
                  <dd className="text-right font-medium text-brown">{formatMoney(fee.studentPriceMinor)}</dd>
                </>
              )}
            </dl>
          )}
          {fee.pairPricesMinor && (
            <div className="mt-2 text-sm">
              <p className="font-medium text-brown">Pair plan (two learners enrolling and paying together)</p>
              <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                {(Object.keys(PAIR_LABELS) as (keyof typeof PAIR_LABELS)[])
                  .filter((t) => fee.pairPricesMinor?.[t] !== undefined)
                  .map((t) => (
                    <div key={t} className="contents">
                      <dt className="text-muted-foreground">{PAIR_LABELS[t]}</dt>
                      <dd className="text-right font-medium text-brown">{formatMoney(fee.pairPricesMinor![t]!)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
          {comingSoon && <p className="mt-2 text-xs text-muted-foreground">Not yet open for enrolment.</p>}
        </>
      )}
    </div>
  );
}
