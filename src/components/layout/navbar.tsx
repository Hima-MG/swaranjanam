import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { Logo } from "@/components/layout/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLinks } from "@/components/layout/nav-links";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { mainNav } from "@/config/site";
import { ROLE_HOME } from "@/lib/auth/constants";
import { getSession } from "@/lib/auth/session";

function GuestActions() {
  return (
    <>
      <Button asChild variant="ghost" className="hidden text-brown sm:inline-flex">
        <Link href="/login">Login</Link>
      </Button>
      <Button asChild className="hidden sm:inline-flex">
        <Link href="/register">Enroll Now</Link>
      </Button>
      <MobileNav />
    </>
  );
}

/**
 * Reads the session cookie, so it renders behind Suspense: the static shell
 * shows the guest buttons and signed-in visitors see theirs stream in. Uses
 * the lightweight (non-revocation) check because this is display-only.
 */
async function AccountActions() {
  let dashboardHref: string | null = null;
  try {
    const user = await getSession(false);
    if (user) dashboardHref = ROLE_HOME[user.role];
  } catch {
    // Misconfigured auth must never break public pages; show guest actions.
  }
  if (!dashboardHref) return <GuestActions />;

  return (
    <>
      <Button asChild variant="ghost" className="hidden text-brown sm:inline-flex">
        <Link href={dashboardHref}>
          <LayoutDashboard data-icon="inline-start" />
          Dashboard
        </Link>
      </Button>
      <LogoutButton variant="outline" className="hidden sm:inline-flex" />
      <MobileNav account={{ dashboardHref }} />
    </>
  );
}

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-cream/85 backdrop-blur-md supports-[backdrop-filter]:bg-cream/75">
      <Container className="flex h-18 items-center justify-between gap-6">
        <Logo eager />
        <nav aria-label="Main" className="hidden lg:block">
          <NavLinks items={mainNav} />
        </nav>
        <div className="flex items-center gap-2">
          <Suspense fallback={<GuestActions />}>
            <AccountActions />
          </Suspense>
        </div>
      </Container>
    </header>
  );
}
