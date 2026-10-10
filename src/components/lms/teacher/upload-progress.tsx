import { Spinner } from "@/components/ui/loading-state";

export function UploadProgress({ status, progress, phase }: { status: string; progress: number; phase: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-brown">
        <Spinner className="size-4" />
        {status}
      </div>
      {phase === "uploading" && (
        <div
          className="h-2 overflow-hidden rounded-full bg-cream-deep"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="h-full rounded-full bg-maroon transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}
