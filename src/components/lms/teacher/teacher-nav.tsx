"use client";

import {
  Activity,
  Boxes,
  Receipt,
  BarChart3,
  Bell,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  IndianRupee,
  LayoutDashboard,
  Megaphone,
  MessageSquareQuote,
  Mic,
  Package,
  Settings,
  Star,
  Tags,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/utils";

export interface TeacherNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Exact match only (the overview), instead of prefix matching. */
  exact?: boolean;
}

// Only sections that exist are listed — no placeholder links. The main workflows
// (courses, enrolment, batches, individual schedules, attendance, invoicing)
// stay separate; everything else is under "More".
export const TEACHER_NAV: TeacherNavItem[] = [
  { href: "/teacher", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/teacher/courses", label: "Course management", icon: BookOpen },
  { href: "/teacher/registrations", label: "Registered students", icon: UserPlus },
  { href: "/teacher/batches", label: "Manage batches", icon: Boxes },
  { href: "/teacher/schedules", label: "Individual schedules", icon: CalendarCheck },
  { href: "/teacher/classes", label: "Classes & attendance", icon: CalendarClock },
  { href: "/teacher/billing", label: "Payments & invoices", icon: Receipt },
  { href: "/teacher/settings", label: "Profile & settings", icon: Settings },
];

export const TEACHER_NAV_MORE: TeacherNavItem[] = [
  { href: "/teacher/students", label: "All students", icon: Users },
  { href: "/teacher/packages", label: "Packages (legacy)", icon: Package },
  { href: "/teacher/payments", label: "Payment records", icon: IndianRupee },
  { href: "/teacher/pricing", label: "Fees & pricing", icon: Tags },
  { href: "/teacher/submissions", label: "Submissions", icon: Mic },
  { href: "/teacher/reviews", label: "Reviews", icon: Star },
  { href: "/teacher/testimonials", label: "Testimonials", icon: MessageSquareQuote },
  { href: "/teacher/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/teacher/announcements", label: "Announcements", icon: Megaphone },
  { href: "/teacher/notifications", label: "Notifications", icon: Bell },
  { href: "/teacher/activity", label: "Activity log", icon: Activity },
];

function isActive(pathname: string | null, item: TeacherNavItem) {
  if (!pathname) return false;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavList({ pathname, layout }: { pathname: string | null; layout: "sidebar" | "tabs" }) {
  const sidebar = layout === "sidebar";
  return (
    // Tabs (small screens): one scrollable row; sidebar: main workflows, then "More".
    <div className={cn(!sidebar && "flex gap-1")}>
      <NavItems items={TEACHER_NAV} pathname={pathname} sidebar={sidebar} />
      {sidebar && <p className="mt-6 mb-2 px-3 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">More</p>}
      <NavItems items={TEACHER_NAV_MORE} pathname={pathname} sidebar={sidebar} />
    </div>
  );
}

function NavItems({ items, pathname, sidebar }: { items: TeacherNavItem[]; pathname: string | null; sidebar: boolean }) {
  return (
    <ul className={cn(sidebar ? "flex flex-col gap-1" : "flex gap-1")}>
      {items.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <li key={item.href} className={cn(!sidebar && "shrink-0")}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-xl text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                sidebar ? "px-3 py-2.5" : "px-3.5 py-2 whitespace-nowrap",
                active ? "bg-maroon text-cream shadow-soft" : "text-brown hover:bg-cream-deep hover:text-maroon",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActiveNavList(props: { layout: "sidebar" | "tabs" }) {
  return <NavList pathname={usePathname()} {...props} />;
}

/** Sidebar on desktop, horizontally scrollable tab bar on smaller screens. */
export function TeacherNav() {
  return (
    <>
      <nav
        aria-label="Teacher dashboard"
        className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
      >
        <p className="mb-3 px-3 text-xs font-semibold tracking-[0.18em] text-gold uppercase">Academy admin</p>
        <Suspense fallback={<NavList pathname={null} layout="sidebar" />}>
          <ActiveNavList layout="sidebar" />
        </Suspense>
      </nav>
      <nav
        aria-label="Teacher dashboard"
        className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 pb-3 sm:-mx-6 sm:px-6 lg:hidden"
      >
        <Suspense fallback={<NavList pathname={null} layout="tabs" />}>
          <ActiveNavList layout="tabs" />
        </Suspense>
      </nav>
    </>
  );
}
