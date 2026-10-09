"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/layout/logo";
import { NavLinks } from "@/components/layout/nav-links";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { mainNav } from "@/config/site";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="bg-cream pattern-kolam-gold">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
          <Logo />
        </SheetHeader>
        <nav aria-label="Mobile" className="px-2">
          <NavLinks items={mainNav} orientation="vertical" onNavigate={close} />
        </nav>
        <SheetFooter className="border-t border-border">
          <Button asChild variant="outline" size="lg">
            <Link href="/login" onClick={close}>
              Login
            </Link>
          </Button>
          <Button asChild size="lg">
            <Link href="/register" onClick={close}>
              Enroll Now
            </Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
