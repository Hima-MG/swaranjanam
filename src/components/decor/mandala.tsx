import { cn } from "@/lib/utils";

const rings = [
  { count: 8, radius: 22, length: 18, width: 7 },
  { count: 16, radius: 46, length: 20, width: 6 },
  { count: 24, radius: 72, length: 16, width: 4.5 },
] as const;

/** Decorative line mandala drawn in currentColor. Purely ornamental. */
export function Mandala({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-100 -100 200 200"
      aria-hidden="true"
      className={cn("text-gold", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="0.6"
    >
      <circle r="96" strokeOpacity="0.5" />
      <circle r="92" strokeDasharray="1 3" strokeOpacity="0.7" />
      <circle r="66" strokeOpacity="0.4" />
      <circle r="40" strokeOpacity="0.4" />
      <circle r="14" />
      <circle r="4" fill="currentColor" />
      {rings.map((ring) =>
        Array.from({ length: ring.count }, (_, i) => {
          const angle = (360 / ring.count) * i;
          const { radius: r, length: l, width: w } = ring;
          return (
            <path
              key={`${ring.radius}-${i}`}
              transform={`rotate(${angle})`}
              d={`M0 ${-r} C${w} ${-r - l * 0.35} ${w * 0.6} ${-r - l * 0.8} 0 ${-r - l} C${-w * 0.6} ${-r - l * 0.8} ${-w} ${-r - l * 0.35} 0 ${-r}Z`}
              fill="currentColor"
              fillOpacity="0.08"
            />
          );
        }),
      )}
      {Array.from({ length: 48 }, (_, i) => (
        <circle
          key={`dot-${i}`}
          transform={`rotate(${7.5 * i})`}
          cy="-88"
          r="0.9"
          fill="currentColor"
          stroke="none"
        />
      ))}
    </svg>
  );
}
