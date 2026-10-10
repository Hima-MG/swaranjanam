import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Styled native <select>: fully keyboard and screen-reader accessible on every platform. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className="h-11 w-full appearance-none rounded-xl border border-input bg-ivory py-2 pr-10 pl-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-brown-muted"
      />
    </div>
  );
}
