import { ArrowLeft, ExternalLink, Eye, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CourseCatalogForm } from "@/components/lms/teacher/course-catalog-form";
import { CourseDetailsForm } from "@/components/lms/teacher/course-details-form";
import { CoursePricingForm, CourseScheduleInfoForm, EnrolledRateChangeForm } from "@/components/lms/teacher/course-pricing-form";
import { CourseStatusControl } from "@/components/lms/teacher/course-status-control";
import { DuplicateCourseButton } from "@/components/lms/teacher/duplicate-course-button";
import { OutlineEditor } from "@/components/lms/teacher/outline-editor";
import { ProgrammeForm } from "@/components/lms/teacher/programme-form";
import { RecordingDialog } from "@/components/lms/teacher/recording-dialog";
import { ThumbnailUploader } from "@/components/lms/teacher/thumbnail-uploader";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/format-date";
import { setProgrammeSessionRecording } from "@/app/(account)/teacher/programme-actions";
import { getCoursePricingOverview } from "@/lib/lms/server/course-pricing";
import { getCourseForEditing } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Edit course" };

type Params = PageProps<"/teacher/courses/[courseId]">["params"];

async function CourseEditor({ params }: { params: Params }) {
  const { courseId } = await params;
  const teacher = await requireRole("teacher", `/teacher/courses/${courseId}`);
  const data = await getCourseForEditing(teacher, courseId);
  if (!data) notFound();
  const { course, outline } = data;
  const pricing = await getCoursePricingOverview(teacher, course);
  const lessonCount = outline.reduce((sum, m) => sum + m.lessons.length, 0);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Link
          href="/teacher/courses"
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All courses
        </Link>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="type-h2 break-words">{course.title}</h1>
            {course.titleMl && (
              <p lang="ml" className="text-brown-muted">
                {course.titleMl}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {outline.length} modules · {lessonCount} lessons · /{course.slug}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CourseStatusControl courseId={course.id} status={course.status} />
            {course.status === "published" && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/courses/${course.slug}`} target="_blank">
                  <ExternalLink data-icon="inline-start" />
                  View public page
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/teacher/courses/${course.id}/preview`}>
                <Eye data-icon="inline-start" />
                Preview
              </Link>
            </Button>
            <DuplicateCourseButton courseId={course.id} title={course.title} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/teacher/courses/${course.id}/students`}>
                <Users data-icon="inline-start" />
                Students
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <section aria-labelledby="details" className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 id="details" className="type-h3">
            Course details
          </h2>
          <CourseDetailsForm course={course} />
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 className="type-h3">Thumbnail</h2>
          <ThumbnailUploader courseId={course.id} title={course.title} thumbnailUrl={course.thumbnailUrl} />
        </div>
      </section>

      <section aria-labelledby="catalogue" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div>
          <h2 id="catalogue" className="type-h3">
            Catalogue details
          </h2>
          <p className="text-sm text-muted-foreground">
            Shown on the public course pages once the course is published.
          </p>
        </div>
        <CourseCatalogForm course={course} />
      </section>

      <section aria-labelledby="programme" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div>
          <h2 id="programme" className="type-h3">
            {course.programme ? "Special Programme" : "Course type: Regular Academy Course"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {course.programme
              ? "One full payment of the total fee confirms a registration. No first-class payment, no monthly invoice."
              : "Regular courses use the first-class payment and monthly invoices below. For a bhajan course, workshop or short course with a fixed total fee, make it a Special Programme (only before any regular student is enrolled)."}
          </p>
        </div>
        {course.programme ? (
          <ProgrammeForm courseId={course.id} programme={course.programme} />
        ) : (
          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold text-maroon">Make this course a Special Programme</summary>
            <div className="mt-3">
              <ProgrammeForm courseId={course.id} programme={null} />
            </div>
          </details>
        )}
        {course.programme && course.programme.sessions.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-brown">Session recordings</h3>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {course.programme.sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-brown">
                    {s.date} {s.start}–{s.end} · {s.title}{" "}
                    <span className="text-muted-foreground">· {s.recordingVideoId ? "Recording added" : "No recording"}</span>
                  </span>
                  <RecordingDialog id={s.id} title={`${s.title} (${s.date})`} currentVideoId={s.recordingVideoId} save={setProgrammeSessionRecording.bind(null, course.id, s.id)} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {!course.programme && (
      <section aria-labelledby="pricing" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div>
          <h2 id="pricing" className="type-h3">
            Classes &amp; pricing
          </h2>
          <p className="text-sm text-muted-foreground">
            Which class types this course offers and its own prices. At least one class type is needed before students can enrol.
          </p>
        </div>
        <CoursePricingForm courseId={course.id} pricing={pricing.pricing} saved={pricing.saved} />
        {(pricing.enrolled.batch > 0 || pricing.enrolled.individual > 0) && (
          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold text-maroon">Change the rate of students already enrolled (approval)</summary>
            <p className="my-3 text-sm text-muted-foreground">
              Enrolled students keep their agreed rate when the course price changes. Use this only for an approved change; it starts from a future month and
              never alters classes already held or invoices already issued.
            </p>
            <EnrolledRateChangeForm courseId={course.id} months={pricing.months} enrolled={pricing.enrolled} />
          </details>
        )}
        {pricing.history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-maroon">Pricing history ({pricing.history.length})</summary>
            <ol className="mt-2 flex flex-col gap-1 border-l border-border pl-4 text-muted-foreground">
              {pricing.history.map((h, i) => (
                <li key={i}>
                  {formatDateTime(h.at)} ·{" "}
                  {h.scope === "existing_students"
                    ? `Enrolled ${h.mode} students: ${h.rateMinor !== null ? formatMoney(h.rateMinor) : "—"} from ${h.effectiveFrom} (approved)`
                    : `New students: batch ${h.batchMinor !== null ? formatMoney(h.batchMinor) : "off"}, individual ${h.individualMinor !== null ? formatMoney(h.individualMinor) : "off"}`}
                  {h.byEmail ? ` · ${h.byEmail}` : ""}
                  {h.scope === "existing_students" && h.note ? ` · ${h.note}` : ""}
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      )}

      <section aria-labelledby="schedule-info" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div>
          <h2 id="schedule-info" className="type-h3">
            Schedule information
          </h2>
          <p className="text-sm text-muted-foreground">General teaching availability shown to students. Not a confirmed student schedule.</p>
        </div>
        <CourseScheduleInfoForm courseId={course.id} info={course.scheduleInfo} />
      </section>

      <section aria-labelledby="curriculum" className="flex flex-col gap-5">
        <div>
          <h2 id="curriculum" className="type-h3">
            Curriculum
          </h2>
          <p className="text-sm text-muted-foreground">
            Organise modules and lessons. Open a lesson to add English and Malayalam videos, audio and PDFs.
          </p>
        </div>
        <OutlineEditor courseId={course.id} outline={outline} />
      </section>
    </div>
  );
}

export default function TeacherCoursePage({ params }: PageProps<"/teacher/courses/[courseId]">) {
  return (
    <>
      <Suspense fallback={<LoadingState label="Loading course…" />}>
        <CourseEditor params={params} />
      </Suspense>
    </>
  );
}
