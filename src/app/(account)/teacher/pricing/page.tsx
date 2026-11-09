import { redirect } from "next/navigation";

// The separate Fees & pricing page was retired: each course's prices are set in
// Course management → course → Pricing, and accepted payment methods are in
// Payments & invoices → Rates & policy. Legacy fee-plan records are kept unchanged.
export default function TeacherPricingPage() {
  redirect("/teacher/courses");
}
