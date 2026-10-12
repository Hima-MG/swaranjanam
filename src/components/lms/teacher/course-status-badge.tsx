import { Badge } from "@/components/ui/badge";
import type { CourseStatus } from "@/lib/lms/types";

export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  if (status === "published") return <Badge variant="gold">Published</Badge>;
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}
