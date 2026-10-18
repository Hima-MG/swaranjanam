import { authorizeRequest } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { paiseToRupeesText } from "@/lib/lms/billing";
import { getRevenueReport } from "@/lib/lms/server/billing";

/** Teacher-only CSV: weekly or monthly revenue (verified payments minus refunds, India time). */
export async function GET(request: Request) {
  const { user, response } = await authorizeRequest("teacher");
  if (response) return response;

  const period = new URL(request.url).searchParams.get("period") === "week" ? "week" : "month";
  const { rows } = await getRevenueReport(user, period);
  const csv = toCsv(
    [period === "week" ? "ISO week" : "Month", "Received (verified)", "Payments", "Refunds", "Net"],
    rows.map((r) => [r.period, paiseToRupeesText(r.receivedMinor), r.receivedCount, paiseToRupeesText(r.refundedMinor), paiseToRupeesText(r.netMinor)]),
  );
  return csvResponse(`swaraanjanam-revenue-${period}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
