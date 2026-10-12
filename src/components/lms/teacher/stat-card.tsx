import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** A single real metric. `value` is rendered as given; pass "—" when there is no data. */
export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: LucideIcon;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="flex size-9 items-center justify-center rounded-xl bg-maroon-soft text-maroon">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <p className="font-heading text-4xl font-semibold text-brown">{value}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </>
  );
  const classes = cn(
    "flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-soft",
    href && "transition-shadow outline-none hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50",
    className,
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
