"use client";

import { CheckCircle2, Circle, Languages } from "lucide-react";
import { useEffect } from "react";

import { recordLessonAccess, setLessonCompleted } from "@/app/(account)/dashboard/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { ResourceViewer } from "@/components/lms/student/resource-viewer";
import { useServerAction } from "@/components/lms/use-server-action";
import { LanguageToggle } from "@/components/shared/language-toggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { useLanguagePreference } from "@/lib/i18n/language-preference";
import { LANGUAGE_LABELS, localized, type LessonRecord } from "@/lib/lms/types";

/**
 * Lesson content in the student's chosen language. The language switch only
 * changes what is displayed from data the server already authorised; it never
 * changes enrollment or permissions. Missing Malayalam (or English) material
 * is reported as unavailable, never silently replaced with the other language.
 */
export function LessonPlayer({
  courseId,
  lesson,
  completed,
  preview = false,
}: {
  courseId: string;
  lesson: LessonRecord;
  completed: boolean;
  /** Teacher preview: shows the student view without recording progress. */
  preview?: boolean;
}) {
  const [language, setLanguage] = useLanguagePreference();
  const completion = useServerAction();

  // Remember this lesson for "Continue learning". Failures are harmless.
  useEffect(() => {
    if (preview) return;
    void recordLessonAccess(courseId, lesson.id).catch(() => undefined);
  }, [courseId, lesson.id, preview]);

  const title = localized(lesson.title, lesson.titleMl, language);
  const notes = localized(lesson.description, lesson.descriptionMl, language);
  const resources = lesson.resources.filter((r) => r.language === language);
  const otherLanguage = language === "en" ? "ml" : "en";
  const otherCount = lesson.resources.length - resources.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0" lang={title ? language : "en"}>
          <h1 className="type-h2 break-words">{title ?? lesson.title}</h1>
          {!title && (
            <p className="mt-1 text-sm text-muted-foreground" lang="en">
              Malayalam title not available. Showing the English title.
            </p>
          )}
        </div>
        <LanguageToggle value={language} onChange={setLanguage} label="Lesson language" className="shrink-0 self-start" />
      </div>

      {notes ? (
        <p lang={language} className="leading-relaxed whitespace-pre-line text-brown">
          {notes}
        </p>
      ) : (
        (language === "ml" ? lesson.description : lesson.descriptionMl) && (
          <p className="text-sm text-muted-foreground">
            Lesson notes are not available in {LANGUAGE_LABELS[language]}.
          </p>
        )
      )}

      <section aria-label={`${LANGUAGE_LABELS[language]} learning materials`} className="flex flex-col gap-4">
        {resources.length === 0 ? (
          <div
            role="status"
            className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6"
          >
            <Languages className="size-6 text-maroon" aria-hidden="true" />
            <p className="text-brown">
              {language === "ml"
                ? "Malayalam materials are not available for this lesson yet."
                : "English materials are not available for this lesson yet."}
            </p>
            {otherCount > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setLanguage(otherLanguage)}>
                View {LANGUAGE_LABELS[otherLanguage]} materials ({otherCount})
              </Button>
            )}
          </div>
        ) : (
          resources.map((resource) => <ResourceViewer key={resource.id} resource={resource} />)
        )}
      </section>

      {!preview && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-brown">
            {completed ? (
              <CheckCircle2 className="size-5 text-gold" aria-hidden="true" />
            ) : (
              <Circle className="size-5 text-brown-muted" aria-hidden="true" />
            )}
            {completed ? "You have completed this lesson." : "Finished practising? Mark this lesson complete."}
          </p>
          <Button
            type="button"
            variant={completed ? "outline" : "default"}
            disabled={completion.pending}
            onClick={() => completion.run(() => setLessonCompleted(courseId, lesson.id, !completed))}
          >
            {completion.pending && <Spinner className="size-4 text-current" />}
            {completed ? "Mark as not complete" : "Mark as complete"}
          </Button>
        </div>
      )}
      {completion.error && <FormAlert tone="error">{completion.error}</FormAlert>}
    </div>
  );
}
