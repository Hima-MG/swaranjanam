import { cn } from "@/lib/utils";

// Minimal, dependency-free charts for the teacher dashboard. Single series
// only (one hue: the brand maroon, contrast ≥ 3:1 on the card surface), so no
// legend is needed — the panel title names the series. Values are printed as
// text in normal ink; every bar has a hover/focus tooltip; each chart is paired
// with a table view. Empty data renders an explicit empty state, never a fake bar.

export interface BarDatum {
  label: string;
  value: number;
  /** Text shown beside the bar and in the tooltip, e.g. "12 students". */
  display: string;
}

/** Horizontal bars for magnitude by category (e.g. enrollments by course). */
export function BarList({ data, emptyText, max }: { data: BarDatum[]; emptyText: string; max?: number }) {
  const top = max ?? Math.max(0, ...data.map((d) => d.value));
  if (data.length === 0 || top === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-[2px]">
      {data.map((d) => (
        <li
          key={d.label}
          tabIndex={0}
          title={`${d.label}: ${d.display}`}
          aria-label={`${d.label}: ${d.display}`}
          className="group grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 outline-none hover:bg-cream-deep/60 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="truncate text-sm text-brown">{d.label}</span>
          <span className="h-3 overflow-hidden rounded-r-[4px] bg-cream-deep" aria-hidden="true">
            <span className="block h-full rounded-r-[4px] bg-maroon" style={{ width: `${(d.value / top) * 100}%` }} />
          </span>
          <span className="text-right text-xs whitespace-nowrap text-muted-foreground">{d.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns over time (e.g. lesson completions per week), with a table view. */
export function ColumnChart({
  data,
  valueLabel,
  emptyText,
}: {
  data: { label: string; value: number }[];
  valueLabel: string;
  emptyText: string;
}) {
  const top = Math.max(0, ...data.map((d) => d.value));
  if (top === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-40 items-end gap-[2px] border-b border-border" role="img" aria-label={`${valueLabel} per week; see the table for values`}>
        {data.map((d) => (
          <span
            key={d.label}
            tabIndex={0}
            title={`${d.label}: ${d.value} ${valueLabel}`}
            aria-label={`${d.label}: ${d.value} ${valueLabel}`}
            className="group relative flex h-full flex-1 items-end outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              className={cn("block w-full rounded-t-[4px]", d.value > 0 ? "bg-maroon group-hover:bg-maroon-deep" : "")}
              style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
            />
          </span>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>Peak: {top}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-maroon">Show as table</summary>
        <table className="mt-2 w-full max-w-sm text-left text-sm">
          <thead className="text-xs text-brown-muted uppercase">
            <tr>
              <th scope="col" className="py-1 font-semibold">Week starting</th>
              <th scope="col" className="py-1 text-right font-semibold">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t border-border">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
