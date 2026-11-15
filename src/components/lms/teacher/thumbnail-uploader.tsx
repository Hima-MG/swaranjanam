"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRef } from "react";

import { createCourseImageUpload, removeCourseImage, saveCourseImage } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { LmsThumbnail } from "@/components/lms/lms-thumbnail";
import { UploadProgress } from "@/components/lms/teacher/upload-progress";
import { useMediaUpload } from "@/components/lms/teacher/use-media-upload";
import { Button } from "@/components/ui/button";
import { UPLOAD_RULES } from "@/lib/media/config";

const COPY = {
  thumbnail: { noun: "thumbnail", hint: "Shown on course cards. A 16:9 landscape image works best.", removed: "the course will show the default artwork" },
  cover: { noun: "cover image", hint: "Wide banner at the top of the public course page. A 3:1 landscape image works best.", removed: "the course page will show no banner" },
} as const;

/** Upload, replace or remove a course image (card thumbnail or page cover). */
export function ThumbnailUploader({
  courseId,
  title,
  thumbnailUrl,
  image = "thumbnail",
}: {
  courseId: string;
  title: string;
  thumbnailUrl: string | null;
  image?: "thumbnail" | "cover";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, cancel, busy, phase, progress, status, error } = useMediaUpload();
  const rule = UPLOAD_RULES.image;
  const copy = COPY[image];

  return (
    <div className="flex flex-col gap-4">
      <LmsThumbnail
        title={title}
        url={thumbnailUrl}
        className={image === "cover" ? "aspect-[3/1] rounded-xl" : "rounded-xl"}
        sizes="(min-width: 1024px) 380px, 100vw"
      />
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
            getTicket: () => createCourseImageUpload(courseId, image),
            save: (receipt) => saveCourseImage(courseId, image, receipt),
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
            {thumbnailUrl ? `Replace ${copy.noun}` : `Upload ${copy.noun}`}
          </Button>
          {thumbnailUrl && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  <Trash2 data-icon="inline-start" />
                  Remove
                </Button>
              }
              title={`Remove the ${copy.noun}?`}
              description={`The image will be deleted and ${copy.removed}.`}
              confirmLabel={`Remove ${copy.noun}`}
              action={() => removeCourseImage(courseId, image)}
            />
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {rule.label}. {copy.hint}
      </p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
    </div>
  );
}
