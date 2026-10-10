"use client";

import { Link2, Pencil, Upload } from "lucide-react";
import { useState } from "react";

import {
  addExternalVideo,
  addUploadedResource,
  createResourceUpload,
  updateResource,
} from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { FormField } from "@/components/forms/form-field";
import { UploadProgress } from "@/components/lms/teacher/upload-progress";
import { useMediaUpload } from "@/components/lms/teacher/use-media-upload";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { UPLOAD_RULES, type UploadKind } from "@/lib/media/config";
import { LANGUAGE_LABELS, RESOURCE_TYPES, type Language, type LessonResource } from "@/lib/lms/types";
import { LIMITS } from "@/lib/lms/validation";

const TYPE_LABELS: Record<UploadKind, string> = {
  video: "Video",
  audio: "Audio",
  pdf: "PDF notes",
  image: "Image",
};

function DownloadCheckbox({ id, defaultChecked }: { id: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name="downloadable"
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 accent-maroon"
      />
      <Label htmlFor={id} className="text-sm leading-snug font-normal text-brown">
        Allow students to download this file
      </Label>
    </div>
  );
}

export function UploadResourceDialog({
  courseId,
  lessonId,
  language,
}: {
  courseId: string;
  lessonId: string;
  language: Language;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<UploadKind>("video");
  const [titleError, setTitleError] = useState<string | null>(null);
  const { upload, cancel, busy, phase, progress, status, error, setError } = useMediaUpload();
  const rule = UPLOAD_RULES[kind];
  const idPrefix = `upload-${language}`;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) {
          setError(null);
          setTitleError(null);
        }
        setOpen(next);
      }}
      className="sm:max-w-lg"
      trigger={
        <Button type="button" size="sm">
          <Upload data-icon="inline-start" />
          Upload resource
        </Button>
      }
      title={`Upload a ${LANGUAGE_LABELS[language]} resource`}
      description="The file uploads directly to the academy's media library. Students see it only after you publish the course and enroll them."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const title = String(data.get("title") ?? "").trim();
          const file = data.get("file");
          setTitleError(title ? null : "Please enter a title.");
          if (!title) return;
          if (!(file instanceof File) || file.size === 0) {
            setError("Please choose a file to upload.");
            return;
          }
          const downloadable = data.get("downloadable") === "on";
          void upload({
            file,
            kind,
            getTicket: () => createResourceUpload(courseId, lessonId, kind),
            save: (receipt) =>
              addUploadedResource(courseId, lessonId, {
                kind,
                language,
                title,
                fileName: file.name,
                downloadable,
                receipt,
              }),
            onSuccess: () => setOpen(false),
          });
        }}
      >
        <fieldset disabled={busy} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-type`} className="text-sm font-medium text-brown">
              Type
            </Label>
            <NativeSelect
              id={`${idPrefix}-type`}
              value={kind}
              onChange={(event) => setKind(event.target.value as UploadKind)}
            >
              {RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <FormField
              id={`${idPrefix}-title`}
              name="title"
              label="Title"
              maxLength={LIMITS.resourceTitle}
              lang={language}
              aria-invalid={titleError ? true : undefined}
              required
            />
            {titleError && <p className="text-xs text-destructive">{titleError}</p>}
          </div>
          <FormField
            id={`${idPrefix}-file`}
            name="file"
            label="File"
            type="file"
            accept={rule.accept.join(",")}
            hint={rule.label}
            className="[&_input]:h-auto [&_input]:py-2.5"
            required
          />
          {(kind === "pdf" || kind === "image") && (
            <DownloadCheckbox id={`${idPrefix}-downloadable`} defaultChecked={kind === "pdf"} />
          )}
        </fieldset>
        {busy && status && <UploadProgress status={status} progress={progress} phase={phase} />}
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          {phase === "uploading" ? (
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel upload
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Close
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Spinner className="size-4 text-cream" />}
            Upload
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AddVideoLinkDialog({
  courseId,
  lessonId,
  language,
}: {
  courseId: string;
  lessonId: string;
  language: Language;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, run, reset } = useServerAction();
  const idPrefix = `link-${language}`;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-lg"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Link2 data-icon="inline-start" />
          Add video link
        </Button>
      }
      title={`Add a ${LANGUAGE_LABELS[language]} video link`}
      description="Only YouTube and Vimeo links are accepted. The video plays inside the lesson."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run(() => addExternalVideo(courseId, lessonId, { language, title: data.get("title"), url: data.get("url") }), {
            onSuccess: () => setOpen(false),
          });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <FormField id={`${idPrefix}-title`} name="title" label="Title" maxLength={LIMITS.resourceTitle} lang={language} required />
            {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <FormField
              id={`${idPrefix}-url`}
              name="url"
              label="Video URL"
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              maxLength={LIMITS.url}
              aria-invalid={fieldErrors.url ? true : undefined}
              required
            />
            {fieldErrors.url && <p className="text-xs text-destructive">{fieldErrors.url}</p>}
          </div>
        </fieldset>
        {error && !fieldErrors.url && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Add link
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function EditResourceDialog({
  courseId,
  lessonId,
  resource,
}: {
  courseId: string;
  lessonId: string;
  resource: LessonResource;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, run, reset } = useServerAction();
  const idPrefix = `edit-${resource.id}`;
  const canDownload = resource.source === "cloudinary" && (resource.type === "pdf" || resource.type === "image");

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-lg"
      trigger={
        <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${resource.title}`}>
          <Pencil />
        </Button>
      }
      title="Edit resource"
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run(
            () =>
              updateResource(courseId, lessonId, resource.id, {
                title: data.get("title"),
                language: data.get("language"),
                downloadable: data.get("downloadable") === "on",
              }),
            { onSuccess: () => setOpen(false) },
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <FormField
              id={`${idPrefix}-title`}
              name="title"
              label="Title"
              defaultValue={resource.title}
              maxLength={LIMITS.resourceTitle}
              lang={resource.language}
              required
            />
            {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-language`} className="text-sm font-medium text-brown">
              Language
            </Label>
            <NativeSelect id={`${idPrefix}-language`} name="language" defaultValue={resource.language}>
              <option value="en">English</option>
              <option value="ml">Malayalam (മലയാളം)</option>
            </NativeSelect>
          </div>
          {canDownload && <DownloadCheckbox id={`${idPrefix}-downloadable`} defaultChecked={resource.downloadable} />}
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
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
