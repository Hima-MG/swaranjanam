"use client";

import { CalendarClock, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatClassTime,
  isWaitingForLink,
  joinPhase,
  JOIN_EARLY_MINUTES,
  nextPhaseBoundary,
  nextWindowOpen,
  type JoinPhase,
  type StudentClassView,
} from "@/lib/lms/classes";

const PHASE_BADGE: Record<JoinPhase, { label: string; variant: "gold" | "outline" | "secondary" | "maroon" }> = {
  upcoming: { label: "Scheduled", variant: "outline" },
  joinable: { label: "Starting now", variant: "gold" },
  ended: { label: "Ended", variant: "secondary" },
  completed: { label: "Completed", variant: "maroon" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

const MAX_TIMER_MS = 12 * 60 * 60 * 1000;
const LINK_RETRY_MS = 15_000;

/**
 * The student's own live classes.
 *
 * Authorization lives on the server: the Meet link is only included in the
 * page data while a class is inside its joining window by the SERVER's clock.
 * This component only decides what to display and when to ask the server
 * again; it cannot grant access to anything.
 *
 * Timing:
 *  - First render uses the server's time so hydration matches.
 *  - A precise timer fires at the next window opening or scheduled end (plus a
 *    30-second fallback tick), so the Join button appears and disappears on time.
 *  - When a window opens, router.refresh() fetches fresh server data so the
 *    link arrives. The delay uses an estimate of the server clock, so a fast
 *    browser clock does not refresh too early.
 *  - If a class is joinable but its link has not arrived (clock skew, network),
 *    the page asks again every 15 seconds until the link arrives or the window ends.
 *  - All timers are cleared on unmount and whenever the class list changes.
 *
 * Limitation: timers further than 12 hours away are not scheduled. A page left
 * open longer than that picks the class up on the next load, refresh or
 * navigation. Browsers may also delay timers in background tabs.
 */
export function UpcomingClasses({ classes, serverNow }: { classes: StudentClassView[]; serverNow: number }) {
  const router = useRouter();
  const [now, setNow] = useState(serverNow);
  // Server clock ≈ browser clock + offset (measured once on mount; includes
  // network latency, which only makes refreshes slightly later, never early).
  const serverOffset = useRef(0);

  useEffect(() => {
    serverOffset.current = serverNow - Date.now();
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
    // Measured on mount only; later serverNow values come from refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Precise re-render at the next phase boundary (window opening or scheduled end).
  useEffect(() => {
    const boundary = nextPhaseBoundary(classes, now);
    if (boundary === null) return;
    const delay = boundary - now + 50;
    if (delay > MAX_TIMER_MS) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(delay, 0));
    return () => window.clearTimeout(id);
  }, [classes, now]);

  // Ask the server again when the next joining window opens (by server time).
  useEffect(() => {
    const serverClock = Date.now() + serverOffset.current;
    const next = nextWindowOpen(classes, serverClock);
    if (next === null) return;
    const delay = next - serverClock + 1000;
    if (delay > MAX_TIMER_MS) return;
    const id = window.setTimeout(() => router.refresh(), Math.max(delay, 0));
    return () => window.clearTimeout(id);
  }, [classes, router]);

  // Joinable by the browser's clock but the server has not sent the link yet: retry.
  const waitingForLink = isWaitingForLink(classes, now);
  useEffect(() => {
    if (!waitingForLink) return;
    const id = window.setTimeout(() => router.refresh(), LINK_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [waitingForLink, classes, router]);

  if (classes.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
        No live classes scheduled. When your teacher schedules a class, it will appear here with a Join Class button.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {classes.map((c) => {
        const phase = joinPhase(c, now);
        const badge = PHASE_BADGE[phase];
        return (
          <li
            key={c.id}
            className={
              phase === "joinable"
                ? "flex flex-col gap-3 rounded-2xl border border-gold/60 bg-gold-soft/40 p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between"
                : "flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between"
            }
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={phase === "cancelled" ? "font-semibold text-muted-foreground line-through" : "font-semibold text-brown"}>{c.title}</h3>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-brown">
                <CalendarClock className="size-4 shrink-0 text-gold" aria-hidden="true" />
                {formatClassTime(c.startAt, c.endAt)}
              </p>
              <p className="text-xs text-muted-foreground">With {c.teacherName} · Google Meet</p>
              {c.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{c.notes}</p>}
              {phase === "cancelled" && (
                <p className="text-sm text-destructive">
                  This class was cancelled{c.cancelReason ? `: ${c.cancelReason}` : "."}
                  {c.packageLinked ? " It does not use a class from your package." : ""}
                </p>
              )}
              {c.attendance && (
                <p className="text-xs text-muted-foreground">{c.attendance === "attended" ? "You attended this class." : "Marked absent (counted as a class)."}</p>
              )}
            </div>
            <div className="shrink-0">
              {phase === "joinable" && c.meetUrl ? (
                <Button asChild>
                  <a href={c.meetUrl} target="_blank" rel="noopener noreferrer">
                    <Video data-icon="inline-start" />
                    Join Class
                    <span className="sr-only"> (opens Google Meet in a new tab)</span>
                  </a>
                </Button>
              ) : phase === "joinable" ? (
                <p className="text-xs text-muted-foreground sm:text-right" role="status">
                  Getting the class link… If the button does not appear, refresh the page.
                </p>
              ) : phase === "upcoming" ? (
                <p className="text-xs text-muted-foreground sm:text-right">Join opens {JOIN_EARLY_MINUTES} minutes before the start.</p>
              ) : phase === "ended" ? (
                <p className="text-xs text-muted-foreground sm:text-right">The scheduled time has passed.</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
