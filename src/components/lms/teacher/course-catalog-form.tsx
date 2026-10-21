"use client";

import { updateCourseCatalog } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CourseRecord } from "@/lib/lms/types";
import { CATALOG_LIMITS, LIMITS } from "@/lib/lms/validation";
import { COURSE_CATEGORIES, COURSE_FORMATS, COURSE_LEVELS, COURSE_TAGS } from "@/types/course";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Choice({
  id,
  name,
  options,
  defaultValue,
  error,
}: {
  id: string;
  name: string;
  options: readonly string[];
  defaultValue: string | null;
  error?: string;
}) {
  return (
    <NativeSelect id={id} name={name} defaultValue={defaultValue ?? ""} aria-invalid={error ? true : undefined}>
      <option value="">Not set</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Everything the public course pages show besides the title/description and outline. */
export function CourseCatalogForm({ course }: { course: CourseRecord }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  const published = course.status === "published";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const input = Object.fromEntries(
          [
            "slug", "subtitle", "subtitleMl", "level", "category", "format", "tag",
            "duration", "ageGroup", "instructor", "price", "originalPrice", "outcomes", "outcomesMl",
          ].map((key) => [key, String(data.get(key) ?? "")]),
        );
        run(() => updateCourseCatalog(course.id, { ...input, featured: data.get("featured") === "on" }), {
          success: "Catalogue details saved.",
        });
      }}
    >
      <fieldset disabled={pending} className="flex flex-col gap-6">
        <Field
          id="catalog-slug"
          label="Web address"
          hint={
            published
              ? "Locked while the course is published, so existing links keep working."
              : "Lowercase letters, numbers and hyphens. Changing it changes the course URL."
          }
          error={e.slug}
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">/courses/</span>
            <Input
              id="catalog-slug"
              name="slug"
              defaultValue={course.slug}
              maxLength={LIMITS.slug}
              readOnly={published}
              aria-invalid={e.slug ? true : undefined}
            />
          </div>
        </Field>

        <div className="grid gap-5 md:grid-cols-2">
          <Field id="catalog-subtitle" label="Short summary (English)" error={e.subtitle}>
            <Input id="catalog-subtitle" name="subtitle" defaultValue={course.subtitle} maxLength={CATALOG_LIMITS.subtitle} lang="en" />
          </Field>
          <Field id="catalog-subtitleMl" label="Short summary (Malayalam)" error={e.subtitleMl}>
            <Input id="catalog-subtitleMl" name="subtitleMl" defaultValue={course.subtitleMl} maxLength={CATALOG_LIMITS.subtitle} lang="ml" />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="catalog-level" label="Level" error={e.level}>
            <Choice id="catalog-level" name="level" options={COURSE_LEVELS} defaultValue={course.level} error={e.level} />
          </Field>
          <Field id="catalog-category" label="Category" error={e.category}>
            <Choice id="catalog-category" name="category" options={COURSE_CATEGORIES} defaultValue={course.category} error={e.category} />
          </Field>
          <Field id="catalog-format" label="Format" error={e.format}>
            <Choice id="catalog-format" name="format" options={COURSE_FORMATS} defaultValue={course.format} error={e.format} />
          </Field>
          <Field id="catalog-tag" label="Highlight label" error={e.tag}>
            <Choice id="catalog-tag" name="tag" options={COURSE_TAGS} defaultValue={course.tag} error={e.tag} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field id="catalog-duration" label="Duration" hint="e.g. 12 weeks" error={e.duration}>
            <Input id="catalog-duration" name="duration" defaultValue={course.duration} maxLength={CATALOG_LIMITS.shortText} />
          </Field>
          <Field id="catalog-ageGroup" label="Age group" hint="e.g. 10 years & above" error={e.ageGroup}>
            <Input id="catalog-ageGroup" name="ageGroup" defaultValue={course.ageGroup} maxLength={CATALOG_LIMITS.shortText} />
          </Field>
          <Field id="catalog-instructor" label="Instructor" error={e.instructor}>
            <Input id="catalog-instructor" name="instructor" defaultValue={course.instructor} maxLength={CATALOG_LIMITS.instructor} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-3 sm:items-start">
          <Field id="catalog-price" label="Fee (₹)" hint="Whole rupees. Used only as the agreed fee for direct course enrollments. The public website shows fees from Fees & pricing (the plan linked to this course)." error={e.price}>
            <Input id="catalog-price" name="price" inputMode="numeric" defaultValue={course.price ?? ""} aria-invalid={e.price ? true : undefined} />
          </Field>
          <Field id="catalog-originalPrice" label="Original fee (₹)" hint="Optional. No longer shown on the public website." error={e.originalPrice}>
            <Input
              id="catalog-originalPrice"
              name="originalPrice"
              inputMode="numeric"
              defaultValue={course.originalPrice ?? ""}
              aria-invalid={e.originalPrice ? true : undefined}
            />
          </Field>
          <div className="flex items-start gap-3 pt-8">
            <input
              id="catalog-featured"
              name="featured"
              type="checkbox"
              defaultChecked={course.featured}
              className="mt-0.5 size-4 accent-maroon"
            />
            <Label htmlFor="catalog-featured" className="text-sm leading-snug font-normal text-brown">
              Feature on the home page
            </Label>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Field id="catalog-outcomes" label="What you will learn (English)" hint="One point per line." error={e.outcomes}>
            <Textarea id="catalog-outcomes" name="outcomes" defaultValue={course.outcomes.join("\n")} rows={5} lang="en" />
          </Field>
          <Field id="catalog-outcomesMl" label="What you will learn (Malayalam)" hint="One point per line." error={e.outcomesMl}>
            <Textarea id="catalog-outcomesMl" name="outcomesMl" defaultValue={course.outcomesMl.join("\n")} rows={5} lang="ml" />
          </Field>
        </div>
      </fieldset>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner className="size-4 text-cream" />}
          {pending ? "Saving…" : "Save catalogue details"}
        </Button>
      </div>
    </form>
  );
}
