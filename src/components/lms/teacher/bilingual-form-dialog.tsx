"use client";

import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import {
  BilingualFields,
  EMPTY_BILINGUAL,
  readBilingualForm,
  type BilingualValues,
} from "@/components/lms/bilingual-fields";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import type { ActionResult } from "@/lib/lms/types";

interface BilingualFormDialogProps {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  idPrefix: string;
  defaults?: BilingualValues;
  submitLabel: string;
  onSubmit: (values: BilingualValues) => Promise<ActionResult<unknown>>;
}

/** Dialog with English + Malayalam title/description fields, for modules and lessons. */
export function BilingualFormDialog({
  trigger,
  title,
  description,
  idPrefix,
  defaults = EMPTY_BILINGUAL,
  submitLabel,
  onSubmit,
}: BilingualFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, run, reset } = useServerAction();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-3xl"
      trigger={trigger}
      title={title}
      description={description}
    >
      <form
        className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          const values = readBilingualForm(event.currentTarget);
          run(() => onSubmit(values), { onSuccess: () => setOpen(false) });
        }}
      >
        <fieldset disabled={pending}>
          <BilingualFields idPrefix={idPrefix} defaults={defaults} errors={fieldErrors} />
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
