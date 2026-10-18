"use client";

import { Check, EyeOff, X } from "lucide-react";
import { useState } from "react";

import { moderateTestimonial } from "@/app/(account)/teacher/testimonial-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import type { ModerationAction, TestimonialStatus } from "@/lib/lms/testimonials";

const ACTIONS: Record<ModerationAction, { label: string; title: string; description: string; destructive: boolean }> = {
  approve: {
    label: "Approve & publish",
    title: "Publish this testimonial?",
    description: "It will appear on the public website exactly as written, with the name the student chose.",
    destructive: false,
  },
  reject: {
    label: "Reject",
    title: "Reject this testimonial?",
    description: "It will not be published. The student can see the status and your note.",
    destructive: true,
  },
  unpublish: {
    label: "Unpublish",
    title: "Remove this testimonial from the website?",
    description: "It is taken off the public site. You can publish it again later while the student's consent stands.",
    destructive: true,
  },
};

function actionsFor(status: TestimonialStatus, consent: boolean): ModerationAction[] {
  if (status === "withdrawn") return [];
  if (status === "pending") return consent ? ["approve", "reject"] : ["reject"];
  if (status === "approved") return ["unpublish"];
  return consent ? ["approve"] : [];
}

export function TestimonialModeration({ id, status, consent }: { id: string; status: TestimonialStatus; consent: boolean }) {
  const [target, setTarget] = useState<ModerationAction | null>(null);
  const { pending, error, run, reset } = useServerAction();
  const options = actionsFor(status, consent);
  if (options.length === 0) return null;
  const config = target ? ACTIONS[target] : null;

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {options.map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant={a === "approve" ? "default" : "ghost"}
            className={a === "approve" ? undefined : "text-destructive"}
            onClick={() => {
              reset();
              setTarget(a);
            }}
          >
            {a === "approve" ? <Check data-icon="inline-start" /> : a === "reject" ? <X data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
            {ACTIONS[a].label}
          </Button>
        ))}
      </div>
      <Modal
        open={target !== null}
        onOpenChange={(next) => {
          if (!next && !pending) setTarget(null);
        }}
        className="sm:max-w-md"
        title={config?.title ?? ""}
        description={config?.description}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const note = new FormData(event.currentTarget).get("note");
            run(() => moderateTestimonial(id, target, note), { onSuccess: () => setTarget(null) });
          }}
        >
          {target !== "approve" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`t-note-${id}`} className="text-sm font-medium text-brown">
                Note for the student (optional)
              </Label>
              <Input id={`t-note-${id}`} name="note" maxLength={300} disabled={pending} />
            </div>
          )}
          {error && <FormAlert tone="error">{error}</FormAlert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              Back
            </Button>
            <Button type="submit" variant={config?.destructive ? "destructive" : "default"} disabled={pending}>
              {pending && <Spinner className="size-4 text-current" />}
              {config?.label}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
