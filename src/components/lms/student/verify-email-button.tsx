"use client";

import { Mail } from "lucide-react";

import { sendMyVerificationEmail } from "@/app/(account)/dashboard/account-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";

/** Sends Firebase's email-verification link to the signed-in student. */
export function VerifyEmailButton() {
  const { pending, error, success, run } = useServerAction();
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        disabled={pending}
        onClick={() =>
          run(sendMyVerificationEmail, {
            success: (r) => (r.sent ? "Verification email sent. Open the link, then sign in again." : "The email could not be sent right now. Please try again later."),
          })
        }
      >
        {pending ? <Spinner className="size-4" /> : <Mail data-icon="inline-start" />}
        Send verification email
      </Button>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="info">{success}</FormAlert>}
    </div>
  );
}
