import { BookOpen, ChevronRight, Clock, MonitorPlay, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogError } from "@/components/course/catalog-states";
import { CourseAbout } from "@/components/course/course-about";
import { CourseBadge } from "@/components/course/course-badge";
import { CourseGrid } from "@/components/course/course-grid";
import { CoursePrice } from "@/components/course/course-price";
import { CourseThumbnail } from "@/components/course/course-thumbnail";
import { EnrollButton } from "@/components/course/enroll-button";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { getPublishedCourseBySlug, getPublishedCourses, relatedCourses } from "@/lib/catalog/server";

// Course pages are rendered from Firestore on first visit (behind loading.tsx)
// and cached under the catalogue tag; teacher changes refresh them. Only
// published courses resolve — drafts and unpublished courses return 404.

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
  const details = [
    course.duration && { icon: Clock, label: "Duration", value: course.duration },
    { icon: BookOpen, label: "Lessons", value: `${course.lessonCount} ${course.lessonCount === 1 ? "lesson" : "lessons"}` },
    course.format && { icon: MonitorPlay, label: "Format", value: course.format },
    course.ageGroup && { icon: Users, label: "Age group", value: course.ageGroup },
  ].filter((d): d is { icon: typeof Clock; label: string; value: string } => Boolean(d));

  return (
    <>
      <section className="relative isolate border-b border-border bg-cream-deep/70 pattern-kolam-gold">
        <Container className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_380px] lg:gap-14 lg:pb-24">
          <div className="flex flex-col gap-5">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Link href="/courses" className="hover:text-maroon">
                Courses
              </Link>
              <ChevronRight className="size-4" aria-hidden="true" />
              <span aria-current="page" className="text-brown">
                {course.title}
              </span>
            </nav>
            <div className="flex flex-wrap gap-2">
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
              <CoursePrice fee={course.fee} size="lg" detailed />
              <div className="flex flex-col gap-3">
                <EnrollButton courseTitle={course.title} />
                <Button asChild size="lg" variant="outline" className="w-full">
                  <Link href="/contact">Book a Free Trial</Link>
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
