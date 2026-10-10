import { BookOpen, Mail, Phone, PlayCircle, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { LmsThumbnail } from "@/components/lms/lms-thumbnail";
import { ProgressBar } from "@/components/lms/progress-bar";
import { PageHero } from "@/components/shared/page-hero";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Section } from "@/components/ui/section";
import { getUserProfile } from "@/lib/auth/profile";
import { requireRole } from "@/lib/auth/session";
import { getStudentOverview } from "@/lib/lms/server/student";

export const metadata: Metadata = { title: "My Dashboard" };

async function StudentDashboard() {
  // Server-side guard: signed-out visitors go to /login, teachers to /teacher.
  const user = await requireRole("student", "/dashboard");
  const [profile, overview] = await Promise.all([getUserProfile(user.uid), getStudentOverview(user)]);
  const name = profile?.displayName ?? user.name ?? "Student";

  const details = [
    { icon: UserRound, label: "Name", value: name },
    { icon: Mail, label: "Email", value: profile?.email ?? user.email ?? "—" },
    { icon: Phone, label: "Phone", value: profile?.phone ?? "—" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
          <p className="type-eyebrow text-gold">Namaskaram, {name.split(" ")[0]}</p>
          {overview.resume ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="type-h3">Continue where you left off</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {overview.resume.courseTitle} · {overview.resume.lessonTitle}
                </p>
              </div>
              <Button asChild>
                <Link href={`/dashboard/courses/${overview.resume.courseId}/lessons/${overview.resume.lessonId}`}>
                  <PlayCircle data-icon="inline-start" />
                  Continue learning
                </Link>
              </Button>
            </div>
          ) : (
            <h2 className="type-h3">Welcome to your music journey</h2>
          )}
        </div>

        <section aria-labelledby="my-courses" className="flex flex-col gap-4">
          <h2 id="my-courses" className="type-h2">
            My courses
          </h2>

          {overview.courses.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6">
              <BookOpen className="size-6 text-maroon" aria-hidden="true" />
              <p className="text-muted-foreground">
                {overview.unavailableCount > 0
                  ? "Your courses are being updated by your teacher and will be back soon."
                  : "You are not enrolled in any courses yet. Once your teacher enrols you, your lessons and practice material will appear here."}
              </p>
              <Button asChild variant="outline">
                <Link href="/courses">Browse Courses</Link>
              </Button>
            </div>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2">
              {overview.courses.map(({ course, progress, nextLesson }) => (
                <li
                  key={course.id}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
                >
                  <LmsThumbnail title={course.title} url={course.thumbnailUrl} />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div>
                      <h3 className="font-heading text-xl font-semibold text-brown">
                        <Link href={`/dashboard/courses/${course.id}`} className="hover:text-maroon">
                          {course.title}
                        </Link>
                      </h3>
                      {course.titleMl && (
                        <p lang="ml" className="text-sm text-brown-muted">
                          {course.titleMl}
                        </p>
                      )}
                    </div>
                    <div className="mt-auto flex flex-col gap-2 pt-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {progress.completedLessons} of {progress.totalLessons} lessons
                        </span>
                        <span>{progress.percent}%</span>
                      </div>
                      <ProgressBar percent={progress.percent} label={`${course.title} progress`} />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {nextLesson && (
                        <Button asChild size="sm">
                          <Link href={`/dashboard/courses/${course.id}/lessons/${nextLesson.id}`}>
                            {progress.completedLessons === 0 ? "Start" : progress.percent === 100 ? "Review" : "Continue"}
                          </Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/dashboard/courses/${course.id}`}>Lessons</Link>
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {overview.courses.length > 0 && overview.unavailableCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {overview.unavailableCount === 1
                ? "One of your courses is"
                : `${overview.unavailableCount} of your courses are`}{" "}
              temporarily unavailable while your teacher updates them.
            </p>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-5 self-start rounded-2xl border border-border bg-card p-7 shadow-soft">
        <h2 className="type-h3">My profile</h2>
        <ul className="flex flex-col gap-4 text-sm">
          {details.map(({ icon: Icon, label, value }) => (
            <li key={label} className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-maroon-soft text-maroon">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="font-medium break-all text-brown">{value}</span>
              </span>
            </li>
          ))}
        </ul>
        <LogoutButton variant="outline" className="self-start" />
      </aside>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHero
        eyebrow="Student dashboard"
        title="Your music journey"
        description="Your courses, lessons and progress — all in one place."
      />
      <Section spacing="sm">
        <Suspense fallback={<LoadingState label="Loading your dashboard…" />}>
          <StudentDashboard />
        </Suspense>
      </Section>
    </>
  );
}
