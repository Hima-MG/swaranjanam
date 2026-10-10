import { CircleAlert, CircleCheck, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const tones = {
  info: { icon: Info, className: "border-gold/40 bg-gold-soft/60 text-brown", iconClass: "text-gold" },
  success: { icon: CircleCheck, className: "border-gold/40 bg-gold-soft/60 text-brown", iconClass: "text-maroon" },
  error: { icon: CircleAlert, className: "border-destructive/30 bg-destructive/5 text-destructive", iconClass: "text-destructive" },
} as const;

export function FormAlert({
  tone = "info",
  className,
  children,
}: {
  tone?: keyof typeof tones;
  className?: string;
  children: React.ReactNode;
}) {
  const { icon: Icon, className: toneClass, iconClass } = tones[tone];
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-xl border p-3 text-sm", toneClass, className)}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
