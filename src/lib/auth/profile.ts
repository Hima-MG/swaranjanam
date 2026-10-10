import "server-only";

import { FieldValue, type Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/auth/constants";

/**
 * Firestore data model — `users/{uid}`.
 * Written only by trusted server code (Admin SDK). Security rules forbid all
 * client writes, so users can never change their own `role`.
 */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  phone: string | null;
  /** Mirror of the `role` custom claim, for display and admin queries. */
  role: Role;
  provider: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const USERS_COLLECTION = "users";

const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 20;

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

export interface NewProfileInput {
  uid: string;
  email: string | null;
  displayName: unknown;
  phone: unknown;
  provider: string;
}

/**
 * Creates the profile on first sign-in. New profiles are ALWAYS students —
 * the role is never taken from the request. Existing profiles are left as-is
 * (never overwritten), so re-running this cannot downgrade or upgrade anyone.
 */
export async function ensureUserProfile(input: NewProfileInput): Promise<void> {
  const ref = getAdminDb().collection(USERS_COLLECTION).doc(input.uid);
  await getAdminDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) return;
    tx.create(ref, {
      uid: input.uid,
      email: input.email,
      displayName: cleanString(input.displayName, MAX_NAME_LENGTH),
      phone: cleanString(input.phone, MAX_PHONE_LENGTH),
      role: "student" satisfies Role,
      provider: input.provider,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getAdminDb().collection(USERS_COLLECTION).doc(uid).get();
  return snapshot.exists ? (snapshot.data() as UserProfile) : null;
}

/** Teacher-only listing. Callers must authorise with `requireRole("teacher")` first. */
export async function listRecentUsers(limit = 50): Promise<UserProfile[]> {
  const snapshot = await getAdminDb()
    .collection(USERS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => doc.data() as UserProfile);
}
