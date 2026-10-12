import { authorizeRequest } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { listPayments, parsePaymentFilters } from "@/lib/lms/server/payments";
import { PAYMENT_METHOD_LABELS } from "@/lib/lms/types";

/** Teacher-only CSV export of payment records, honouring the page filters. */
export async function GET(request: Request) {
  const { user, response } = await authorizeRequest("teacher");
  if (response) return response;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = await listPayments(user, { ...parsePaymentFilters(params), page: 1 });

  const csv = toCsv(
    ["Payment date", "Student", "Student email", "Course", "Amount", "Currency", "Method", "Reference", "Status", "Verified", "Source", "Notes", "Recorded by", "Recorded at", "Last updated by", "Last updated at"],
    result.allRows.map((p) => [
      p.paidAt?.slice(0, 10),
      p.studentName,
      p.studentEmail,
      p.courseTitle,
      (p.amountMinor / 100).toFixed(2),
      p.currency,
      PAYMENT_METHOD_LABELS[p.method],
      p.reference,
      p.status,
      p.verified ? "yes" : "no",
      p.source,
      p.notes,
      p.createdByEmail,
      p.createdAt,
      p.updatedByEmail,
      p.updatedAt,
    ]),
  );
  return csvResponse(`swaraanjanam-payments-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
