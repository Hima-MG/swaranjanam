"use server";

import { FieldValue } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { getAdminAuth } from "@/lib/firebase/admin";
import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { col } from "@/lib/lms/server/db";
import type { ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Academy operations: announcements, notification read-state and the
// teacher's own profile. Every action re-checks the teacher session.

interface AnnouncementInput {
  title: unknown;
  titleMl: unknown;
  body: unknown;
  bodyMl: unknown;
  courseId: unknown;
  published: unknown;
  pinned: unknown;
}

async function parseAnnouncement(input: AnnouncementInput) {
  const value = {
    title: cleanText(input?.title, 150),
    titleMl: cleanText(input?.titleMl, 150),
    body: cleanText(input?.body, 4000),
    bodyMl: cleanText(input?.bodyMl, 4000),
    courseId: null as string | null,
    published: input?.published === true,
    pinned: input?.pinned === true,
  };
  const errors: Record<string, string> = {};
  if (!value.title) errors.title = "Enter an English title.";
  if (!value.body) errors.body = "Write the announcement in English.";
  if (input?.courseId) {
    if (!isValidId(input.courseId) || !(await col("courses").doc(input.courseId).get()).exists) {
      errors.courseId = "Choose a course from the list.";
    } else {
      value.courseId = input.courseId;
    }
  }
  if (Object.keys(errors).length) throw new AccessError("Please fix the highlighted fields.", errors);
  return value;
}

export async function saveAnnouncement(announcementId: unknown, input: AnnouncementInput): Promise<ActionResult> {
  return runAction("saveAnnouncement", async () => {
    const user = await requireActionUser("teacher");
    const value = await parseAnnouncement(input);
    if (announcementId) {
      if (!isValidId(announcementId)) throw new AccessError("That announcement could not be found.");
      const ref = col("announcements").doc(announcementId);
      if (!(await ref.get()).exists) throw new AccessError("That announcement could not be found.");
      await ref.update({ ...value, updatedBy: user.uid, updatedAt: FieldValue.serverTimestamp() });
      await writeAudit(user, { action: "announcement.update", targetType: "announcement", targetId: ref.id, summary: `Updated announcement "${value.title}"` });
    } else {
      const ref = col("announcements").doc();
      await ref.create({
        ...value,
        createdBy: user.uid,
        createdByEmail: user.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAudit(user, {
        action: "announcement.create",
        targetType: "announcement",
        targetId: ref.id,
        summary: `${value.published ? "Published" : "Drafted"} announcement "${value.title}"`,
      });
    }
    refresh();
    return null;
  });
}

export async function deleteAnnouncement(announcementId: unknown): Promise<ActionResult> {
  return runAction("deleteAnnouncement", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(announcementId)) throw new AccessError("That announcement could not be found.");
    const ref = col("announcements").doc(announcementId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new AccessError("That announcement could not be found.");
    await ref.delete();
    await writeAudit(user, {
      action: "announcement.delete",
      targetType: "announcement",
      targetId: announcementId,
      summary: `Deleted announcement "${String(snapshot.get("title") ?? "")}"`,
    });
    refresh();
    return null;
  });
}

/** Marks every current notification as read for this teacher. */
export async function markNotificationsRead(): Promise<ActionResult> {
  return runAction("markNotificationsRead", async () => {
    const user = await requireActionUser("teacher");
    await col("users").doc(user.uid).set({ notificationsSeenAt: FieldValue.serverTimestamp() }, { merge: true });
    refresh();
    return null;
  });
}

/** The teacher's own display name and phone. The role can never be changed here. */
export async function updateTeacherProfile(input: { displayName: unknown; phone: unknown }): Promise<ActionResult> {
  return runAction("updateTeacherProfile", async () => {
    const user = await requireActionUser("teacher");
    const displayName = cleanText(input?.displayName, 100);
    const phone = cleanText(input?.phone, 20);
    const errors: Record<string, string> = {};
    if (!displayName) errors.displayName = "Enter your name.";
    if (phone && !/^[+\d][\d\s-]{5,19}$/.test(phone)) errors.phone = "Enter a valid phone number.";
    if (Object.keys(errors).length) throw new AccessError("Please fix the highlighted fields.", errors);
    await col("users").doc(user.uid).set({ displayName, phone: phone || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await getAdminAuth().updateUser(user.uid, { displayName });
    await writeAudit(user, { action: "settings.profile", targetType: "settings", targetId: user.uid, summary: "Updated own teacher profile" });
    refresh();
    return null;
  });
}
