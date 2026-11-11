"use server";

import { requireActionUser, runAction } from "@/lib/lms/server/access";
import type { ActionResult } from "@/lib/lms/types";
import { listOwnNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications/service";
import type { NotificationView } from "@/lib/notifications/types";

// Student notification bell. The session uid is the only identity used: a
// student can read and update only their own notifications (checked on the
// server for every call; client SDK access is denied by the security rules).

export async function getMyNotifications(): Promise<ActionResult<{ items: NotificationView[]; unreadCount: number }>> {
  return runAction("getMyNotifications", async () => listOwnNotifications(await requireActionUser("student")));
}

export async function markMyNotificationRead(id: unknown): Promise<ActionResult> {
  return runAction("markMyNotificationRead", async () => {
    await markNotificationRead(await requireActionUser("student"), id);
    return null;
  });
}

export async function markAllMyNotificationsRead(): Promise<ActionResult<{ updated: number }>> {
  return runAction("markAllMyNotificationsRead", async () => ({ updated: await markAllNotificationsRead(await requireActionUser("student")) }));
}
