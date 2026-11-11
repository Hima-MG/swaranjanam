"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { getMyNotifications, markAllMyNotificationsRead, markMyNotificationRead } from "@/app/(account)/dashboard/notification-actions";
import { Button } from "@/components/ui/button";
import type { NotificationView } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Student dashboard notification bell: unread count, list, mark read, mark all read. */
export function NotificationBell({ initial }: { initial: { items: NotificationView[]; unreadCount: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initial.items);
  const [unread, setUnread] = useState(initial.unreadCount);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      // Refresh on open so new notices appear without reloading the page.
      startTransition(async () => {
        const result = await getMyNotifications().catch(() => null);
        if (result?.ok) {
          setItems(result.data.items);
          setUnread(result.data.unreadCount);
        }
      });
    }
  }

  function markRead(n: NotificationView) {
    if (n.isRead) return Promise.resolve(true);
    setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
    return markMyNotificationRead(n.id)
      .then((r) => r.ok)
      .catch(() => false);
  }

  function openNotification(n: NotificationView) {
    setError(null);
    startTransition(async () => {
      await markRead(n);
      setOpen(false);
      router.push(n.link);
    });
  }

  function markAll() {
    setError(null);
    startTransition(async () => {
      const result = await markAllMyNotificationsRead().catch(() => null);
      if (result?.ok) {
        setItems((xs) => xs.map((x) => ({ ...x, isRead: true })));
        setUnread(0);
      } else {
        setError(result && !result.ok ? result.error : "Could not reach the server. Please try again.");
      }
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative rounded-full"
      >
        <Bell aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-5 font-semibold text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-4 top-20 z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="font-semibold">Notifications</p>
            <Button type="button" variant="ghost" size="sm" onClick={markAll} disabled={pending || unread === 0}>
              <CheckCheck data-icon="inline-start" />
              Mark all as read
            </Button>
          </div>
          {error && <p className="border-b border-border px-4 py-2 text-sm text-destructive">{error}</p>}
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
              <Bell className="size-6 text-gold" aria-hidden />
              <p>You have no notifications yet.</p>
              <p>Updates about your registration, payments and classes will appear here.</p>
            </div>
          ) : (
            <ul className="overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="border-b border-border last:border-b-0">
                  <div className={cn("flex gap-3 px-4 py-3", !n.isRead && "bg-gold-soft/30")}>
                    <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-primary")} />
                    <button type="button" onClick={() => openNotification(n)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:underline">
                      <span className={cn("block text-sm", !n.isRead && "font-semibold")}>{n.title}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{n.message}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{formatWhen(n.createdAt)}</span>
                    </button>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => startTransition(async () => void (await markRead(n)))}
                        className="shrink-0 self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                        aria-label={`Mark “${n.title}” as read`}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
