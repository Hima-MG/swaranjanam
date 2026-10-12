import { Badge } from "@/components/ui/badge";
import type { PaymentStatus } from "@/lib/lms/types";

const STYLES: Record<PaymentStatus, { label: string; variant: "gold" | "outline" | "secondary" | "destructive" }> = {
  paid: { label: "Paid", variant: "gold" },
  pending: { label: "Pending", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
  refunded: { label: "Refunded", variant: "secondary" },
};

export function PaymentStatusBadge({ status, verified }: { status: PaymentStatus; verified?: boolean }) {
  const style = STYLES[status];
  return (
    <Badge variant={style.variant}>
      {style.label}
      {status === "paid" && verified === false ? " (unverified)" : ""}
    </Badge>
  );
}
