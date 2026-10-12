import { authorizeRequest } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { listStudents, parseDirectoryQuery } from "@/lib/lms/server/admin";

/** Teacher-only CSV export of the student directory, honouring the same filters as the page. */
export async function GET(request: Request) {
  const { user, response } = await authorizeRequest("teacher");
  if (response) return response;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = await listStudents(user, { ...parseDirectoryQuery(params), page: 1 });

  const csv = toCsv(
    ["Name", "Email", "Phone", "Joined", "Last activity", "Activity", "Active courses", "Revoked enrollments", "Average completion %"],
    result.allRows.map((row) => [
      row.displayName,
      row.email,
      row.phone,
      row.createdAt?.slice(0, 10),
      row.lastActivity?.slice(0, 10),
      row.activity,
      row.activeCourses.map((c) => c.title).join("; "),
      row.revokedCount,
      row.averageCompletion,
    ]),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`swaraanjanam-students-${stamp}.csv`, csv);
}
