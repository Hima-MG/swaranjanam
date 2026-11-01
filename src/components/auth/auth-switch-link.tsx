"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { sanitizeNextPath } from "@/lib/auth/constants";

/**
 * Link between the login and register pages that keeps the `next` path, so a
 * student who starts enrolling, then creates an account, returns to the same
 * enrolment page. The server still only honours `next` inside the user's area.
 */
export function AuthSwitchLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const next = sanitizeNextPath(useSearchParams().get("next"));
  return (
    <Link href={next ? `${href}?next=${encodeURIComponent(next)}` : href} className={className}>
      {children}
    </Link>
  );
}
