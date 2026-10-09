import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLinks } from "@/components/layout/nav-links";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { mainNav } from "@/config/site";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-cream/85 backdrop-blur-md supports-[backdrop-filter]:bg-cream/75">
      <Container className="flex h-18 items-center justify-between gap-6">
        <Logo />
        <nav aria-label="Main" className="hidden lg:block">
          <NavLinks items={mainNav} />
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" className="hidden text-brown sm:inline-flex">
            <Link href="/login">Login</Link>
          </Button>
          <Button asChild className="hidden sm:inline-flex">
            <Link href="/register">Enroll Now</Link>
          </Button>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
