import { cva, type VariantProps } from "class-variance-authority";

import { Container, type ContainerProps } from "@/components/ui/container";
import { cn } from "@/lib/utils";

const sectionVariants = cva("relative isolate", {
  variants: {
    tone: {
      default: "bg-background",
      muted: "bg-cream-deep/60",
      card: "bg-ivory",
      maroon: "bg-maroon-deep text-cream",
    },
    spacing: {
      sm: "py-12 sm:py-16",
      md: "py-16 sm:py-24",
      lg: "py-20 sm:py-28",
    },
    pattern: {
      none: "",
      kolam: "",
    },
  },
  compoundVariants: [
    { pattern: "kolam", tone: "maroon", className: "pattern-kolam-light" },
    { pattern: "kolam", tone: ["default", "muted", "card"], className: "pattern-kolam-gold" },
  ],
  defaultVariants: { tone: "default", spacing: "md", pattern: "none" },
});

export interface SectionProps
  extends React.ComponentProps<"section">,
    VariantProps<typeof sectionVariants> {
  containerSize?: ContainerProps["size"];
}

export function Section({
  tone,
  spacing,
  pattern,
  containerSize,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={cn(sectionVariants({ tone, spacing, pattern }), className)} {...props}>
      <Container size={containerSize}>{children}</Container>
    </section>
  );
}
