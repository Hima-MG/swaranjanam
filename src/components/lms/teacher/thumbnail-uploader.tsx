"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRef } from "react";

import {
  createThumbnailUpload,
  removeCourseThumbnail,
  saveCourseThumbnail,
} from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { LmsThumbnail } from "@/components/lms/lms-thumbnail";
import { UploadProgress } from "@/components/lms/teacher/upload-progress";
import { useMediaUpload } from "@/components/lms/teacher/use-media-upload";
import { Button } from "@/components/ui/button";
import { UPLOAD_RULES } from "@/lib/media/config";

export function ThumbnailUploader({
  courseId,
  title,
  thumbnailUrl,
}: {
  courseId: string;
  title: string;
  thumbnailUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, cancel, busy, phase, progress, status, error } = useMediaUpload();
  const rule = UPLOAD_RULES.image;

  return (
    <div className="flex flex-col gap-4">
      <LmsThumbnail title={title} url={thumbnailUrl} className="rounded-xl" sizes="(min-width: 1024px) 380px, 100vw" />
      <input
        ref={inputRef}
        type="file"
        accept={rule.accept.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void upload({
            file,
            kind: "image",
            getTicket: () => createThumbnailUpload(courseId),
            save: (receipt) => saveCourseThumbnail(courseId, receipt),
          });
        }}
      />
      {busy && status ? (
        <div className="flex flex-col gap-2">
          <UploadProgress status={status} progress={progress} phase={phase} />
          {phase === "uploading" && (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={cancel}>
              Cancel upload
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <ImageUp data-icon="inline-start" />
            {thumbnailUrl ? "Replace thumbnail" : "Upload thumbnail"}
          </Button>
          {thumbnailUrl && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  <Trash2 data-icon="inline-start" />
                  Remove
                </Button>
              }
              title="Remove the thumbnail?"
              description="The image will be deleted and the course will show the default artwork."
              confirmLabel="Remove thumbnail"
              action={() => removeCourseThumbnail(courseId)}
            />
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{rule.label}. A 16:9 landscape image works best.</p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
    </div>
  );
}
