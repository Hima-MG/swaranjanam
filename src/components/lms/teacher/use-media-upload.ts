"use client";

import { useRef, useState, useTransition } from "react";

import type { UploadTicket } from "@/lib/media/cloudinary";
import { checkFileForUpload, type UploadKind } from "@/lib/media/config";
import { UploadError, uploadToCloudinary, type UploadReceiptLike } from "@/lib/media/upload-client";
import type { ActionResult } from "@/lib/lms/types";

type Phase = "idle" | "preparing" | "uploading" | "saving";

/**
 * Signed upload in three steps, each with visible state:
 *   1. ask the server for a signed ticket (authorises the teacher),
 *   2. upload the file straight to Cloudinary with progress,
 *   3. ask the server to verify the upload and save the record.
 * Nothing is saved unless step 3 succeeds; errors are always shown.
 */
export function useMediaUpload() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  async function upload(options: {
    file: File;
    kind: UploadKind;
    getTicket: () => Promise<ActionResult<UploadTicket>>;
    save: (receipt: UploadReceiptLike) => Promise<ActionResult<unknown>>;
    onSuccess?: () => void;
  }) {
    setError(null);
    const problem = checkFileForUpload(options.kind, options.file);
    if (problem) {
      setError(problem);
      return;
    }

    try {
      setPhase("preparing");
      const ticket = await options.getTicket();
      if (!ticket.ok) throw new UploadError(ticket.error);

      setPhase("uploading");
      setProgress(0);
      abortRef.current = new AbortController();
      const receipt = await uploadToCloudinary(ticket.data, options.file, setProgress, abortRef.current.signal);

      setPhase("saving");
      // Inside a transition so the refreshed server UI is applied with the result.
      await new Promise<void>((resolve, reject) => {
        startTransition(async () => {
          try {
            const saved = await options.save(receipt);
            if (saved.ok) resolve();
            else reject(new UploadError(saved.error));
          } catch {
            reject(new UploadError("Could not reach the server to save the upload. Please try again."));
          }
        });
      });
      setPhase("idle");
      options.onSuccess?.();
    } catch (err) {
      setPhase("idle");
      setError(err instanceof UploadError ? err.message : "Upload failed. Please try again.");
    } finally {
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const busy = phase !== "idle";
  const status =
    phase === "preparing"
      ? "Preparing upload…"
      : phase === "uploading"
        ? `Uploading… ${Math.round(progress * 100)}%`
        : phase === "saving"
          ? "Verifying and saving…"
          : null;

  return { upload, cancel, busy, phase, progress, status, error, setError };
}
