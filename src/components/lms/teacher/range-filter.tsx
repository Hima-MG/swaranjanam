import Link from "next/link";

import { cn } from "@/lib/utils";

const LABELS = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "365d": "12 months", all: "All time" } as const;
export type RangeKey = keyof typeof LABELS;

/** Date-range switch as plain links (works without JavaScript; keyboard accessible). */
export function RangeFilter({ value, basePath }: { value: RangeKey; basePath: string }) {
  return (
    <div role="group" aria-label="Date range" className="inline-flex flex-wrap rounded-full border border-border bg-ivory p-1 shadow-soft">
      {(Object.keys(LABELS) as RangeKey[]).map((key) => (
        <Link
          key={key}
          href={`${basePath}?range=${key}`}
          aria-current={key === value ? "true" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            key === value ? "bg-maroon text-cream" : "text-brown hover:bg-cream-deep",
          )}
        >
          {LABELS[key]}
        </Link>
      ))}
    </div>
  );
}

export function rangeLabel(key: RangeKey) {
  return key === "all" ? "all time" : `the last ${LABELS[key]}`;
}
