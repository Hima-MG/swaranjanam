import { authorizeRequest } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { PACKAGE_REPORT_HEADERS, packageReportRow } from "@/lib/lms/billing";
import { listPackagesForTeacher, parsePackageFilters } from "@/lib/lms/server/billing";

/** Teacher-only CSV: package sales, status, balances and class credits (student-wise package history). */
export async function GET(request: Request) {
  const { user, response } = await authorizeRequest("teacher");
  if (response) return response;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { rows } = await listPackagesForTeacher(user, parsePackageFilters(params));
  const csv = toCsv(PACKAGE_REPORT_HEADERS, rows.map(packageReportRow));
  return csvResponse(`swaraanjanam-packages-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
