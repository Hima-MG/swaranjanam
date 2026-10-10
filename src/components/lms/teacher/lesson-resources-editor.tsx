"use client";

import { Download, ExternalLink, Trash2 } from "lucide-react";

import { deleteResource, moveResource } from "@/app/(account)/teacher/actions";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { RESOURCE_TYPE_LABELS, ResourceIcon } from "@/components/lms/resource-icon";
import { ReorderButtons } from "@/components/lms/teacher/reorder-buttons";
import {
  AddVideoLinkDialog,
  EditResourceDialog,
  UploadResourceDialog,
} from "@/components/lms/teacher/resource-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/media/config";
import { LANGUAGES, type Language, type LessonResource } from "@/lib/lms/types";

const SECTION_TITLES: Record<Language, { title: string; native?: string }> = {
  en: { title: "English resources" },
  ml: { title: "Malayalam resources", native: "മലയാളം" },
};

function ResourceRow({
  courseId,
  lessonId,
  resource,
  index,
  count,
}: {
  courseId: string;
  lessonId: string;
  resource: LessonResource;
  index: number;
  count: number;
}) {
  const details = [
    RESOURCE_TYPE_LABELS[resource.type],
    resource.source === "external" ? "External link" : resource.format?.toUpperCase(),
    resource.bytes ? formatBytes(resource.bytes) : null,
    resource.fileName,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-3 border-t border-dashed border-border py-3 first:border-t-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-maroon-soft text-maroon">
          <ResourceIcon type={resource.type} className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span lang={resource.language} className="font-medium break-words text-brown">
            {resource.title}
          </span>
          <span className="text-xs break-all text-muted-foreground">{details.join(" · ")}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-12 sm:pl-0">
        {resource.downloadable && (
          <Badge variant="gold">
            <Download />
            Downloadable
          </Badge>
        )}
        <Button asChild variant="ghost" size="sm">
          <a href={resource.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${resource.title} in a new tab`}>
            <ExternalLink />
          </a>
        </Button>
        <ReorderButtons
          label={resource.title}
          isFirst={index === 0}
          isLast={index === count - 1}
          onMove={(direction) => moveResource(courseId, lessonId, resource.id, direction)}
        />
        <EditResourceDialog courseId={courseId} lessonId={lessonId} resource={resource} />
        <ConfirmDialog
          trigger={
            <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${resource.title}`}>
              <Trash2 />
            </Button>
          }
          title="Delete this resource?"
          description={
            resource.source === "cloudinary"
              ? "The file will be removed from the lesson and deleted from the media library. This cannot be undone."
              : "The video link will be removed from the lesson."
          }
          confirmLabel="Delete resource"
          action={() => deleteResource(courseId, lessonId, resource.id)}
        />
      </div>
    </li>
  );
}

/** Separate English and Malayalam sections, each with its own resources and add/upload controls. */
export function LessonResourcesEditor({
  courseId,
  lessonId,
  resources,
}: {
  courseId: string;
  lessonId: string;
  resources: LessonResource[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {LANGUAGES.map((language) => {
        const items = resources.filter((r) => r.language === language);
        const heading = SECTION_TITLES[language];
        return (
          <section
            key={language}
            aria-labelledby={`resources-${language}`}
            className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 id={`resources-${language}`} className="type-h3">
                {heading.title}
                {heading.native && (
                  <span lang="ml" className="ml-2 text-base font-normal text-brown-muted">
                    {heading.native}
                  </span>
                )}
              </h3>
              <div className="flex flex-wrap gap-2">
                <UploadResourceDialog courseId={courseId} lessonId={lessonId} language={language} />
                <AddVideoLinkDialog courseId={courseId} lessonId={lessonId} language={language} />
              </div>
            </div>
            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-cream-deep/40 p-4 text-sm text-muted-foreground">
                No {language === "en" ? "English" : "Malayalam"} resources yet. Students who choose this language
                will see a message that nothing is available.
              </p>
            ) : (
              <ol>
                {items.map((resource, index) => (
                  <ResourceRow
                    key={resource.id}
                    courseId={courseId}
                    lessonId={lessonId}
                    resource={resource}
                    index={index}
                    count={items.length}
                  />
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
