import { Badge } from "@/components/ui/badge";
import type { CourseStatus } from "@/lib/lms/types";

export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  return status === "published" ? (
    <Badge variant="gold">Published</Badge>
  ) : (
    <Badge variant="outline">Draft</Badge>
  );
}
