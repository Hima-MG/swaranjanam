"use client";

import { useState } from "react";

import { setEnrolmentRequestStatus } from "@/app/(account)/teacher/enrolment-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Mark a request handled (after placing the student with the usual tools) or decline it with a reason. */
export function EnrolmentRequestActions({ requestId }: { requestId: string }) {
  const [declining, setDeclining] = useState(false);
  const { pending, error, run } = useServerAction();
  return (
    <div className="flex flex-col gap-2">
      {declining ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => setEnrolmentRequestStatus(requestId, "declined", new FormData(event.currentTarget).get("note")));
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`decline-${requestId}`} className="text-xs text-brown">
              Reason (shown to the student)
            </Label>
            <Input id={`decline-${requestId}`} name="note" required maxLength={300} className="h-9" />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            Decline
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(false)} disabled={pending}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => setEnrolmentRequestStatus(requestId, "handled", ""))}>
            Mark handled
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(true)}>
            Decline…
          </Button>
        </div>
      )}
      {error && <FormAlert tone="error">{error}</FormAlert>}
    </div>
  );
}
