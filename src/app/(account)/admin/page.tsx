import { redirect } from "next/navigation";

// Legacy route: the teacher area moved to /teacher. next.config.ts redirects
// this path before it renders; this page is a fallback for the same rule.
export default function AdminPage() {
  redirect("/teacher");
}
