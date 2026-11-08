"use client";

import { Video } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import type { ActionResult } from "@/lib/lms/types";

/**
 * Add / change / remove a YouTube recording. `save` is a bound Server Action
 * (e.g. setClassRecording.bind(null, classId)); the server validates the URL
 * and stores only the video id.
 */
export function RecordingDialog({
  id,
  title,
  currentVideoId,
  save,
}: {
  id: string;
  title: string;
  currentVideoId: string | null;
  save: (url: string | null) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, run, reset } = useServerAction();
  const inputId = `recording-${id}`;
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-md"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Video data-icon="inline-start" />
          {currentVideoId ? "Edit recording" : "Add recording"}
        </Button>
      }
      title={currentVideoId ? "Edit recording" : "Add recording"}
      description={`YouTube recording for “${title}”. Shown only to signed-in learners of this class.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const url = String(new FormData(event.currentTarget).get("url") ?? "");
          run(() => save(url), { onSuccess: () => setOpen(false) });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>YouTube link</Label>
          <Input
            id={inputId}
            name="url"
            type="url"
            required
            disabled={pending}
            placeholder="https://www.youtube.com/watch?v=…"
            defaultValue={currentVideoId ? `https://www.youtube.com/watch?v=${currentVideoId}` : ""}
            aria-invalid={Boolean(fieldErrors.url)}
          />
          {fieldErrors.url && <p className="text-xs text-destructive">{fieldErrors.url}</p>}
          <p className="text-xs text-muted-foreground">
            Use an Unlisted video. Unlisted is not fully private: anyone who obtains the link can watch it.
          </p>
        </div>
        {error && !fieldErrors.url && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex flex-wrap justify-end gap-2">
          {currentVideoId && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => save(null), { onSuccess: () => setOpen(false) })}
            >
              Remove recording
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
