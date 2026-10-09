import { BookOpen, Check, ChevronRight, Clock, MonitorPlay, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CourseBadge } from "@/components/course/course-badge";
import { CourseGrid } from "@/components/course/course-grid";
import { CoursePrice } from "@/components/course/course-price";
import { CourseRating } from "@/components/course/course-rating";
import { CourseThumbnail } from "@/components/course/course-thumbnail";
import { EnrollButton } from "@/components/course/enroll-button";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { formatCount } from "@/lib/format";
import { getAllCourses, getCourseBySlug, getRelatedCourses } from "@/lib/courses";

export function generateStaticParams() {
  return getAllCourses().map((course) => ({ slug: course.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/courses/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const course = getCourseBySlug(slug);
  if (!course) return { title: "Course not found" };
  return { title: course.title, description: course.description };
}

export default async function CourseDetailPage({ params }: PageProps<"/courses/[slug]">) {
  const { slug } = await params;
  const course = getCourseBySlug(slug);
  if (!course) notFound();

  const related = getRelatedCourses(course, 3);
  const details = [
    { icon: Clock, label: "Duration", value: course.duration },
    { icon: BookOpen, label: "Lessons", value: `${course.lessonCount} lessons` },
    { icon: MonitorPlay, label: "Format", value: course.format },
    { icon: Users, label: "Age group", value: course.ageGroup },
  ];

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
              <CourseBadge kind="level" value={course.level} />
              <CourseBadge kind="format" value={course.format} />
            </div>
            <h1 className="type-h1">{course.title}</h1>
            <p className="type-lead max-w-2xl text-muted-foreground">{course.subtitle}</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-brown-muted">
              <CourseRating rating={course.rating} reviewCount={course.reviewCount} size="md" />
              <span>{formatCount(course.studentCount)} students enrolled</span>
              <span>By {course.instructor}</span>
            </div>
          </div>

        </Container>
      </section>

      <Container className="grid gap-14 py-14 sm:py-20 lg:grid-cols-[1fr_380px]">
          {/* Enrollment card: first on mobile, overlaps the hero in the right column on desktop. */}
          <aside className="lg:col-start-2 lg:row-start-1 lg:-mt-80">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:sticky lg:top-24">
              <CourseThumbnail course={course} priority sizes="(min-width: 1024px) 380px, 100vw" />
              <div className="flex flex-col gap-5 p-6">
                <CoursePrice
                  price={course.price}
                  originalPrice={course.originalPrice}
                  size="lg"
                  showDiscount
                />
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
                      <span className="font-medium text-brown">{value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        <div className="flex flex-col gap-14 lg:col-start-1 lg:row-start-1">
          <section aria-labelledby="about-course" className="flex flex-col gap-4">
            <h2 id="about-course" className="type-h2">
              About this course
            </h2>
            <p className="type-lead text-muted-foreground">{course.description}</p>
          </section>

          <section
            aria-labelledby="outcomes"
            className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-7 shadow-soft sm:p-9"
          >
            <h2 id="outcomes" className="type-h3">
              What you will learn
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {course.outcomes.map((outcome) => (
                <li key={outcome} className="flex gap-3 text-sm leading-relaxed">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-gold-soft text-maroon">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                  {outcome}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="curriculum" className="flex flex-col gap-6">
            <div className="flex items-end justify-between gap-4">
              <h2 id="curriculum" className="type-h2">
                Curriculum
              </h2>
              <span className="text-sm text-muted-foreground">
                {course.curriculum.length} modules · {course.lessonCount} lessons
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {course.curriculum.map((module, index) => (
                <details
                  key={module.title}
                  open={index === 0}
                  className="group rounded-2xl border border-border bg-card shadow-soft open:border-gold/40"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-4 p-5 [&::-webkit-details-marker]:hidden">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-maroon-soft font-heading text-lg font-semibold text-maroon">
                      {index + 1}
                    </span>
                    <span className="flex-1 font-heading text-xl font-semibold text-brown">
                      {module.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {module.lessons.length} lessons
                    </span>
                    <ChevronRight
                      className="size-4 text-gold transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                  </summary>
                  <ul className="flex flex-col border-t border-border px-5 py-3">
                    {module.lessons.map((lesson) => (
                      <li
                        key={lesson}
                        className="flex items-center gap-3 border-b border-dashed border-border py-3 text-sm text-brown last:border-0"
                      >
                        <MonitorPlay className="size-4 text-brown-muted" aria-hidden="true" />
                        {lesson}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        </div>
      </Container>

      {related.length > 0 && (
        <Section tone="muted">
          <SectionHeader
            align="left"
            eyebrow="Keep exploring"
            title="Related courses"
          />
          <CourseGrid courses={related} />
        </Section>
      )}
    </>
  );
}
