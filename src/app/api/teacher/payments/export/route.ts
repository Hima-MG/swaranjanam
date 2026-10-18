import { authorizeRequest } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { PAYMENT_REPORT_HEADERS, paymentReportRow } from "@/lib/lms/billing";
import { listPayments, parsePaymentFilters } from "@/lib/lms/server/payments";
import { PAYMENT_METHOD_LABELS } from "@/lib/lms/types";

/**
 * Teacher-only CSV export of payment records, honouring the page filters.
 * References are masked and teacher notes, student emails and staff emails are
 * left out; the full details stay in the dashboard.
 */
export async function GET(request: Request) {
  const { user, response } = await authorizeRequest("teacher");
  if (response) return response;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = await listPayments(user, { ...parsePaymentFilters(params), page: 1 });

  const csv = toCsv(
    PAYMENT_REPORT_HEADERS,
    result.allRows.map((p) => paymentReportRow({ ...p, methodLabel: PAYMENT_METHOD_LABELS[p.method] ?? "Other" })),
  );
  return csvResponse(`swaraanjanam-payments-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
