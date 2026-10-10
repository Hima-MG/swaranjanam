"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/lms/types";

/** Move up / move down buttons. Keyboard-accessible alternative to drag and drop. */
export function ReorderButtons({
  label,
  isFirst,
  isLast,
  onMove,
}: {
  /** Name of the item, for screen readers ("Move <label> up"). */
  label: string;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: "up" | "down") => Promise<ActionResult<unknown>>;
}) {
  const { pending, error, run } = useServerAction();
  return (
    <span className="inline-flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={pending || isFirst}
        aria-label={`Move ${label} up`}
        title="Move up"
        onClick={() => run(() => onMove("up"))}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={pending || isLast}
        aria-label={`Move ${label} down`}
        title="Move down"
        onClick={() => run(() => onMove("down"))}
      >
        <ArrowDown />
      </Button>
      {error && (
        <span role="alert" className="ml-1 text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
