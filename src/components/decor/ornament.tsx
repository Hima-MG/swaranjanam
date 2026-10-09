import { cn } from "@/lib/utils";

/** Small lotus-and-line flourish used beneath headings and between sections. */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 20"
      aria-hidden="true"
      className={cn("h-5 w-40 text-gold", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <path d="M2 10h52M106 10h52" strokeLinecap="round" />
      <circle cx="58" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="102" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <path d="M80 2c3 3.5 3 8.5 0 12-3-3.5-3-8.5 0-12Z" fill="currentColor" fillOpacity="0.2" />
      <path d="M80 14c-4-1-8.5-4-10-8 4.5 0 8 3 10 8Zm0 0c4-1 8.5-4 10-8-4.5 0-8 3-10 8Z" />
      <path d="M66 10c3 2.5 8 4.5 14 4.5S91 12.5 94 10" strokeLinecap="round" />
    </svg>
  );
}
