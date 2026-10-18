import "server-only";

import { TEACHER_CLAIMS } from "@/lib/auth/constants";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AccessError } from "@/lib/lms/server/access";
import { col } from "@/lib/lms/server/db";
import { isValidId } from "@/lib/lms/validation";

/**
 * The uid must belong to an existing, enabled STUDENT account with a profile.
 * Used by teacher actions (classes, packages) so a browser-supplied id is never
 * trusted. Kept out of "use server" files so it is not callable as an action.
 */
export async function assertStudent(studentId: unknown, field = "studentId"): Promise<{ uid: string; label: string; name: string }> {
  const invalid = () => new AccessError("Please fix the highlighted fields.", { [field]: "Choose a registered student." });
  if (!isValidId(studentId)) throw invalid();
  const [profile, account] = await Promise.all([
    col("users").doc(studentId).get(),
    getAdminAuth()
      .getUser(studentId)
      .catch(() => null),
  ]);
  const claim = account?.customClaims?.role;
  if (!profile.exists || !account || account.disabled || (typeof claim === "string" && TEACHER_CLAIMS.includes(claim))) throw invalid();
  const displayName = typeof profile.get("displayName") === "string" ? (profile.get("displayName") as string) : null;
  return {
    uid: studentId,
    label: account.email ?? account.displayName ?? studentId,
    name: displayName || account.displayName || account.email || "Student",
  };
}
