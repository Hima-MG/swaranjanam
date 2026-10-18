import { authorizeRequest } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { ADJUSTMENT_KIND_LABELS, paiseToRupeesText } from "@/lib/lms/billing";
import { listAdjustmentsForTeacher } from "@/lib/lms/server/billing";

/** Teacher-only CSV: approved refunds, fee waivers and class-credit changes. */
export async function GET() {
  const { user, response } = await authorizeRequest("teacher");
  if (response) return response;

  const rows = await listAdjustmentsForTeacher(user);
  const csv = toCsv(
    ["Date", "Package", "Learners", "Type", "Amount", "Classes", "Reason", "Approved by"],
    rows.map((a) => [
      a.at?.slice(0, 10) ?? "",
      a.packageTitle,
      a.learners,
      ADJUSTMENT_KIND_LABELS[a.kind],
      a.kind === "credit" ? "" : paiseToRupeesText(a.amountMinor),
      a.kind === "credit" ? a.credits : "",
      a.reason,
      a.approvedByEmail ?? "",
    ]),
  );
  return csvResponse(`swaraanjanam-adjustments-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
