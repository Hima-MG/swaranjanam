"use client";

import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { useServerAction } from "@/components/lms/use-server-action";
import type { ActionResult } from "@/lib/lms/types";

interface ConfirmDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** Runs only after the user confirms. */
  action: () => Promise<ActionResult<unknown>>;
  destructive?: boolean;
  onDone?: () => void;
}

/** Confirmation step for destructive or significant actions. Stays open on failure to show the error. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  action,
  destructive = true,
  onDone,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, reset } = useServerAction();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      trigger={trigger}
      title={title}
      description={description}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              run(action, {
                onSuccess: () => {
                  setOpen(false);
                  onDone?.();
                },
              })
            }
          >
            {pending && <Spinner className="size-4 text-current" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && <FormAlert tone="error">{error}</FormAlert>}
    </Modal>
  );
}
