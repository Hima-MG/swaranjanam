import { BookOpen, CalendarClock, ChevronRight, MonitorPlay, Users, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogError } from "@/components/course/catalog-states";
import { CourseAbout } from "@/components/course/course-about";
import { CourseBadge } from "@/components/course/course-badge";
import { CourseFeeLine } from "@/components/course/course-fees";
import { CourseGrid } from "@/components/course/course-grid";
import { CourseThumbnail } from "@/components/course/course-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { FEE_TERMS } from "@/lib/catalog/public-pricing";
import { PROGRAMME_TYPE_LABELS } from "@/lib/lms/programme";
import { getPublishedCourseBySlug, getPublishedCourses, relatedCourses } from "@/lib/catalog/server";
import { BEFORE_FIRST_CLASS, CLASS_STRUCTURE, WORKBOOK_FOUNDATION_SLUGS } from "@/data/before-first-class";
import { formatMoney } from "@/lib/format";
import { COURSE_AVAILABILITY_LABELS } from "@/types/course";

// Course pages are rendered on first visit (behind loading.tsx) and cached
// under the catalogue tag; teacher changes refresh them. Only publicly listed
// courses resolve (published with an availability set, or the academy's
// approved catalogue until the course exists in Firestore); others return 404.
// Fees are the academy's current per-session rates — the same figures as the
// homepage "Courses & fees" section.

export async function generateMetadata({ params }: PageProps<"/courses/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublishedCourseBySlug(slug);
  if (!result.ok) return { title: "Courses" };
  const course = result.data;
  if (!course) return { title: "Course not found" };
  const description = course.subtitle || course.description.slice(0, 160);
  return {
    title: course.title,
    description,
    alternates: { canonical: `/courses/${course.slug}` },
    openGraph: {
      title: course.title,
      description,
      ...(course.thumbnailUrl ? { images: [{ url: course.thumbnailUrl }] } : {}),
    },
  };
}

export default async function CourseDetailPage({ params }: PageProps<"/courses/[slug]">) {
  const { slug } = await params;
  const [result, catalog] = await Promise.all([getPublishedCourseBySlug(slug), getPublishedCourses()]);
  if (!result.ok) {
    return (
      <Section>
        <CatalogError />
      </Section>
    );
  }
  const course = result.data;
  if (!course) notFound();

  const related = catalog.ok ? relatedCourses(catalog.data, course, 3) : [];
  const open = course.availability === "open";
  const details = [
    open && { icon: MonitorPlay, label: "Class", value: "Live online · Google Meet" },
    open && { icon: CalendarClock, label: "Schedule", value: "1 hour, once a week" },
    open && { icon: Users, label: "Batch size", value: "Up to 5 students" },
    course.ageGroup && { icon: UsersRound, label: "Who it's for", value: course.ageGroup },
    course.lessonCount > 0 && { icon: BookOpen, label: "Lessons", value: `${course.lessonCount} ${course.lessonCount === 1 ? "lesson" : "lessons"}` },
  ].filter((d): d is { icon: typeof MonitorPlay; label: string; value: string } => Boolean(d));

  return (
    <>
      <section className="relative isolate border-b border-border bg-cream-deep/70 pattern-kolam-gold">
        <Container className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_380px] lg:gap-14 lg:pb-24">
          <div className="flex flex-col gap-5">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Link href="/#courses" className="hover:text-maroon">
                Courses &amp; fees
              </Link>
              <ChevronRight className="size-4" aria-hidden="true" />
              <span aria-current="page" className="text-brown">
                {course.title}
              </span>
            </nav>
            <div className="flex flex-wrap gap-2">
              <Badge variant={open ? "gold" : "cream"}>{COURSE_AVAILABILITY_LABELS[course.availability]}</Badge>
              {course.tag && <CourseBadge kind="tag" value={course.tag} />}
              {course.level && <CourseBadge kind="level" value={course.level} />}
              {course.format && <CourseBadge kind="format" value={course.format} />}
            </div>
            <h1 className="type-h1">{course.title}</h1>
            {course.titleMl && (
              <p lang="ml" className="text-xl text-brown-muted">
                {course.titleMl}
              </p>
            )}
            {course.subtitle && <p className="type-lead max-w-2xl text-muted-foreground">{course.subtitle}</p>}
            {course.subtitleMl && (
              <p lang="ml" className="max-w-2xl text-muted-foreground">
                {course.subtitleMl}
              </p>
            )}
            {course.instructor && <p className="text-sm text-brown-muted">By {course.instructor}</p>}
          </div>
        </Container>
      </section>

      <Container className="grid gap-14 py-14 sm:py-20 lg:grid-cols-[1fr_380px]">
        {/* Enrollment card: first on mobile, overlaps the hero in the right column on desktop. */}
        <aside className="lg:col-start-2 lg:row-start-1 lg:-mt-80">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:sticky lg:top-24">
            <CourseThumbnail course={course} priority sizes="(min-width: 1024px) 380px, 100vw" />
            <div className="flex flex-col gap-5 p-6">
              <CourseFeeLine fee={course.fee} programme={course.programme} />
              {!course.programme && course.fee && (course.fee.batchMinor !== null || course.fee.individualMinor !== null) && (
                <p className="-mt-3 text-sm text-muted-foreground">
                  Learn Together (2 people, one login):{" "}
                  {[
                    course.fee.batchMinor !== null && course.fee.sharedBatchMinor !== null ? `batch ${formatMoney(course.fee.sharedBatchMinor)} per person (${formatMoney(course.fee.sharedBatchMinor * 2)} for two)` : "",
                    course.fee.individualMinor !== null && course.fee.sharedIndividualMinor !== null
                      ? `one-to-one ${formatMoney(course.fee.sharedIndividualMinor)} per person (${formatMoney(course.fee.sharedIndividualMinor * 2)} for two)`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  per session.
                </p>
              )}
              <div className="flex flex-col gap-3">
                {open ? (
                  <>
                    <Button asChild size="lg" className="w-full">
                      <Link href={`/enrol/${course.slug}`}>Enrol Now</Link>
                    </Button>
                    {course.programme ? (
                      <p className="-mt-1 text-xs text-muted-foreground">
                        Add the learner&apos;s details, then pay the full programme fee ({formatMoney(course.programme.feeMinor)}) once. Your registration is confirmed
                        when the payment is verified — there is no monthly invoice.
                      </p>
                    ) : (
                    <p className="-mt-1 text-xs text-muted-foreground">
                      Choose batch or individual classes, add the learner&apos;s details and preferred times, then pay for the first class{" "}
                      {course.fee
                        ? `(${[course.fee.batchMinor !== null ? `${formatMoney(course.fee.batchMinor)} batch` : "", course.fee.individualMinor !== null ? `${formatMoney(course.fee.individualMinor)} individual` : ""].filter(Boolean).join(" or ")})`
                        : ""}
                      . It is deducted on your first monthly invoice, and your student login is created once the payment is verified.
                    </p>
                    )}
                  </>
                ) : (
                  <p className="rounded-xl bg-cream-deep/70 p-3 text-sm text-brown">
                    {course.availability === "closed" ? "Closed for new enrolments." : "Coming soon — not yet open for enrolment."}
                  </p>
                )}
                <Button asChild size="lg" variant="outline" className="w-full">
                  <Link href="/contact">{open ? "Ask a question" : "Ask about this course"}</Link>
                </Button>
              </div>
              <ul className="flex flex-col gap-3 border-t border-border pt-5 text-sm">
                {details.map(({ icon: Icon, label, value }) => (
                  <li key={label} className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Icon className="size-4 text-gold" aria-hidden="true" />
                      {label}
                    </span>
                    <span className="text-right font-medium text-brown">{value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
        <div className="flex flex-col gap-14 lg:col-start-1 lg:row-start-1">
          <CourseAbout
            description={course.description}
            descriptionMl={course.descriptionMl}
            outcomes={course.outcomes}
            outcomesMl={course.outcomesMl}
          />

          {course.prerequisites.length > 0 && (
            <section aria-labelledby="prerequisites" className="flex flex-col gap-3">
              <h2 id="prerequisites" className="type-h2">
                Before you start
              </h2>
              <ul className="flex flex-col gap-2 text-brown">
                {course.prerequisites.map((p) => (
                  <li key={p} className="before:mr-2 before:text-gold before:content-['•']">
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {open && WORKBOOK_FOUNDATION_SLUGS.includes(course.slug) && (
            <section aria-labelledby="class-structure" className="flex flex-col gap-3">
              <h2 id="class-structure" className="type-h2">
                What happens in each class
              </h2>
              <p className="text-brown">{CLASS_STRUCTURE}</p>
            </section>
          )}

          {open && WORKBOOK_FOUNDATION_SLUGS.includes(course.slug) && (
            <section aria-labelledby="before-first-class" className="flex flex-col gap-4">
              <h2 id="before-first-class" className="type-h2">
                Before your first class
              </h2>
              <ul className="flex flex-col gap-4">
                {BEFORE_FIRST_CLASS.map((b) => (
                  <li key={b.item} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                    <h3 className="font-semibold text-brown">{b.item}</h3>
                    <p className="mt-1 text-brown">{b.details}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {b.how}
                      {b.link && (
                        <>
                          {" · "}
                          <a href={b.link} target="_blank" rel="noopener noreferrer" className="font-medium text-maroon hover:underline">
                            More details
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {course.programme && (
            <section aria-labelledby="programme-details" className="flex flex-col gap-4">
              <h2 id="programme-details" className="type-h2">
                Programme details
              </h2>
              <ul className="flex flex-col gap-2 text-brown">
                <li>
                  {PROGRAMME_TYPE_LABELS[course.programme.programmeType]} · {course.programme.startDate} to {course.programme.endDate}
                  {course.programme.durationText ? ` · ${course.programme.durationText}` : ""}
                </li>
                <li>Total fee {formatMoney(course.programme.feeMinor)}, paid once in full. No first-class payment and no monthly invoice.</li>
                {course.programme.maxParticipants !== null && <li>Up to {course.programme.maxParticipants} participants.</li>}
                <li>{course.programme.recordingsAvailable ? "Session recordings are available to registered participants." : "Session recordings are not provided."}</li>
              </ul>
              {course.programme.sessions.length > 0 && (
                <ol className="flex flex-col gap-1 text-sm text-brown">
                  {course.programme.sessions.map((s, i) => (
                    <li key={`${s.date}-${s.start}`}>
                      Session {i + 1}: {s.date}, {s.start}–{s.end} IST · {s.title}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {open && !course.programme && (
            <section aria-labelledby="how-fees-work" className="flex flex-col gap-4">
              <h2 id="how-fees-work" className="type-h2">
                How fees work
              </h2>
              <ul className="flex flex-col gap-2 text-brown">
                {FEE_TERMS.map((term) => (
                  <li key={term} className="before:mr-2 before:text-gold before:content-['•']">
                    {term}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                See all courses and fees on the{" "}
                <Link href="/#courses" className="font-medium text-maroon hover:underline">
                  homepage
                </Link>
                .
              </p>
            </section>
          )}

          {course.curriculum.length > 0 && (
            <section aria-labelledby="curriculum" className="flex flex-col gap-6">
              <div className="flex items-end justify-between gap-4">
                <h2 id="curriculum" className="type-h2">
                  Curriculum
                </h2>
                <span className="text-sm text-muted-foreground">
                  {course.moduleCount} modules · {course.lessonCount} lessons
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {course.curriculum.map((module, index) => (
                  <details
                    key={`${index}-${module.title}`}
                    open={index === 0}
                    className="group rounded-2xl border border-border bg-card shadow-soft open:border-gold/40"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-4 p-5 [&::-webkit-details-marker]:hidden">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-maroon-soft font-heading text-lg font-semibold text-maroon">
                        {index + 1}
                      </span>
                      <span className="flex flex-1 flex-col">
                        <span className="font-heading text-xl font-semibold text-brown">{module.title}</span>
                        {module.titleMl && (
                          <span lang="ml" className="text-sm text-brown-muted">
                            {module.titleMl}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{module.lessons.length} lessons</span>
                      <ChevronRight
                        className="size-4 text-gold transition-transform group-open:rotate-90"
                        aria-hidden="true"
                      />
                    </summary>
                    {module.lessons.length > 0 && (
                      <ul className="flex flex-col border-t border-border px-5 py-3">
                        {module.lessons.map((lesson, lessonIndex) => (
                          <li
                            key={`${lessonIndex}-${lesson.title}`}
                            className="flex items-center gap-3 border-b border-dashed border-border py-3 text-sm text-brown last:border-0"
                          >
                            <MonitorPlay className="size-4 shrink-0 text-brown-muted" aria-hidden="true" />
                            <span className="flex flex-col">
                              {lesson.title}
                              {lesson.titleMl && (
                                <span lang="ml" className="text-xs text-brown-muted">
                                  {lesson.titleMl}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>
      </Container>

      {related.length > 0 && (
        <Section tone="muted">
          <SectionHeader align="left" eyebrow="Keep exploring" title="Related courses" />
          <CourseGrid courses={related} />
        </Section>
      )}
    </>
  );
}
