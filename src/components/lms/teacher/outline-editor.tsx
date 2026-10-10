"use client";

import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import {
  createLesson,
  createModule,
  deleteModule,
  moveLesson,
  moveModule,
  updateModule,
} from "@/app/(account)/teacher/actions";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { BilingualFormDialog } from "@/components/lms/teacher/bilingual-form-dialog";
import { ReorderButtons } from "@/components/lms/teacher/reorder-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LessonSummary, ModuleWithLessons } from "@/lib/lms/types";

function MalayalamTitle({ value }: { value: string }) {
  return value ? (
    <span lang="ml" className="text-sm text-brown-muted">
      {value}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground italic">No Malayalam title</span>
  );
}

function LessonRow({
  courseId,
  lesson,
  index,
  count,
}: {
  courseId: string;
  lesson: LessonSummary;
  index: number;
  count: number;
}) {
  return (
    <li className="flex flex-col gap-3 border-t border-dashed border-border py-3 first:border-t-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <FileText className="mt-0.5 size-4 shrink-0 text-brown-muted" aria-hidden="true" />
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/teacher/courses/${courseId}/lessons/${lesson.id}`}
            className="font-medium text-brown hover:text-maroon hover:underline"
          >
            {index + 1}. {lesson.title}
          </Link>
          <MalayalamTitle value={lesson.titleMl} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
        <Badge variant={lesson.resourceCounts.en ? "maroon" : "outline"} title="English resources">
          EN {lesson.resourceCounts.en}
        </Badge>
        <Badge variant={lesson.resourceCounts.ml ? "maroon" : "outline"} title="Malayalam resources">
          ML {lesson.resourceCounts.ml}
        </Badge>
        <ReorderButtons
          label={`lesson ${lesson.title}`}
          isFirst={index === 0}
          isLast={index === count - 1}
          onMove={(direction) => moveLesson(courseId, lesson.id, direction)}
        />
        <Button asChild variant="outline" size="sm">
          <Link href={`/teacher/courses/${courseId}/lessons/${lesson.id}`}>
            <Pencil data-icon="inline-start" />
            Edit
          </Link>
        </Button>
      </div>
    </li>
  );
}

export function OutlineEditor({ courseId, outline }: { courseId: string; outline: ModuleWithLessons[] }) {
  return (
    <div className="flex flex-col gap-5">
      {outline.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
          No modules yet. Add a module, then add lessons to it.
        </p>
      )}

      {outline.map((module, moduleIndex) => (
        <section
          key={module.id}
          aria-label={`Module ${moduleIndex + 1}: ${module.title}`}
          className="rounded-2xl border border-border bg-card shadow-soft"
        >
          <header className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-start">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-maroon-soft font-heading text-lg font-semibold text-maroon">
              {moduleIndex + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="font-heading text-xl font-semibold text-brown">{module.title}</h3>
              <MalayalamTitle value={module.titleMl} />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <ReorderButtons
                label={`module ${module.title}`}
                isFirst={moduleIndex === 0}
                isLast={moduleIndex === outline.length - 1}
                onMove={(direction) => moveModule(courseId, module.id, direction)}
              />
              <BilingualFormDialog
                trigger={
                  <Button type="button" variant="ghost" size="sm">
                    <Pencil data-icon="inline-start" />
                    Edit
                  </Button>
                }
                title="Edit module"
                idPrefix={`module-${module.id}`}
                defaults={module}
                submitLabel="Save module"
                onSubmit={(values) => updateModule(courseId, module.id, values)}
              />
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost" size="sm" aria-label={`Delete module ${module.title}`}>
                    <Trash2 />
                  </Button>
                }
                title="Delete this module?"
                description={
                  module.lessons.length > 0
                    ? "This module still has lessons. Delete its lessons first; this protects lesson media from being removed by accident."
                    : "The empty module will be removed. This cannot be undone."
                }
                confirmLabel="Delete module"
                action={() => deleteModule(courseId, module.id)}
              />
            </div>
          </header>

          <div className="px-5 py-2">
            {module.lessons.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No lessons in this module yet.</p>
            ) : (
              <ol>
                {module.lessons.map((lesson, lessonIndex) => (
                  <LessonRow
                    key={lesson.id}
                    courseId={courseId}
                    lesson={lesson}
                    index={lessonIndex}
                    count={module.lessons.length}
                  />
                ))}
              </ol>
            )}
          </div>

          <footer className="border-t border-border p-4">
            <BilingualFormDialog
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <Plus data-icon="inline-start" />
                  Add lesson
                </Button>
              }
              title={`Add a lesson to “${module.title}”`}
              description="You can add videos, audio and PDFs after creating the lesson."
              idPrefix={`new-lesson-${module.id}`}
              submitLabel="Create lesson"
              onSubmit={(values) => createLesson(courseId, module.id, values)}
            />
          </footer>
        </section>
      ))}

      <BilingualFormDialog
        trigger={
          <Button type="button" className="self-start">
            <Plus data-icon="inline-start" />
            Add module
          </Button>
        }
        title="Add a module"
        idPrefix="new-module"
        submitLabel="Create module"
        onSubmit={(values) => createModule(courseId, values)}
      />
    </div>
  );
}
