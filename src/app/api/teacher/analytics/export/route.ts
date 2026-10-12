import { authorizeRequest } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { getAnalytics, parseRange } from "@/lib/lms/server/admin";

/** Teacher-only CSV of the per-course learning report for the selected range. */
export async function GET(request: Request) {
  const { user, response } = await authorizeRequest("teacher");
  if (response) return response;

  const range = parseRange(new URL(request.url).searchParams.get("range"));
  const data = await getAnalytics(user, range);
  const csv = toCsv(
    [
      "Course",
      "Status",
      "Lessons",
      "Enrollments (all)",
      "Active enrollments",
      `New enrollments (${range})`,
      "Average completion %",
      "Students finished",
      `Lesson completions (${range})`,
      "Review average (excl. hidden)",
      "Review count",
    ],
    data.courses.map((c) => [
      c.title,
      c.status,
      c.lessons,
      c.enrollmentsTotal,
      c.enrollmentsActive,
      c.enrollmentsNew,
      c.averageCompletion,
      c.completedStudents,
      c.lessonCompletionsInRange,
      c.reviewAverage,
      c.reviewCount,
    ]),
  );
  return csvResponse(`swaraanjanam-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
