import { LoadingState } from "@/components/ui/loading-state";

// Suspense boundary for the course page: keeps the shared App Shell free of
// URL-specific data so navigation to any course renders instantly.
export default function CourseLoading() {
  return (
    <div className="border-b border-border bg-cream-deep/70 pattern-kolam-gold">
      <LoadingState label="Loading course…" className="min-h-[60vh]" />
    </div>
  );
}
