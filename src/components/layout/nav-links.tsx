"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import type { NavItem } from "@/config/site";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  items: NavItem[];
  orientation?: "horizontal" | "vertical";
  onNavigate?: () => void;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinkList({
  items,
  orientation = "horizontal",
  onNavigate,
  pathname,
}: NavLinksProps & { pathname?: string }) {
  const vertical = orientation === "vertical";

  return (
    <ul className={cn("flex", vertical ? "flex-col gap-1" : "items-center gap-1")}>
      {items.map((item) => {
        const active = pathname ? isActive(pathname, item.href) : false;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative block rounded-full text-sm font-medium transition-colors",
                vertical ? "px-4 py-3 text-base" : "px-4 py-2",
                active
                  ? "text-maroon"
                  : "text-brown/80 hover:bg-cream-deep hover:text-maroon",
                active &&
                  !vertical &&
                  "after:absolute after:inset-x-4 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-gold",
                active && vertical && "bg-maroon-soft",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActiveNavLinks(props: NavLinksProps) {
  const pathname = usePathname();
  return <NavLinkList {...props} pathname={pathname} />;
}

/**
 * Navigation links with active-route highlighting. `usePathname` can suspend
 * under Cache Components for unknown dynamic params, so the active-state
 * variant is wrapped in Suspense with a plain list as the fallback.
 */
export function NavLinks(props: NavLinksProps) {
  return (
    <Suspense fallback={<NavLinkList {...props} />}>
      <ActiveNavLinks {...props} />
    </Suspense>
  );
}
