import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CourseFormat, CourseLevel, CourseTag } from "@/types/course";

const tagVariants = {
  Bestseller: "gold",
  Popular: "cream",
  New: "default",
  "Limited Seats": "maroon",
} as const satisfies Record<CourseTag, string>;

type CourseBadgeProps = { className?: string } & (
  | { kind: "tag"; value: CourseTag }
  | { kind: "level"; value: CourseLevel }
  | { kind: "format"; value: CourseFormat }
);

export function CourseBadge({ className, ...props }: CourseBadgeProps) {
  switch (props.kind) {
    case "tag":
      return (
        <Badge variant={tagVariants[props.value]} className={cn("shadow-soft", className)}>
          {props.value}
        </Badge>
      );
    case "level":
      return (
        <Badge variant="outline" className={cn("text-brown-muted", className)}>
          {props.value}
        </Badge>
      );
    case "format":
      return (
        <Badge variant="maroon" className={className}>
          {props.value}
        </Badge>
      );
  }
}
