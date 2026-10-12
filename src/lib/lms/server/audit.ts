import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { col, toIso } from "@/lib/lms/server/db";
import type { AuditEntry } from "@/lib/lms/types";

// Activity/audit records for sensitive teacher actions (enrollments,
// revocations, payments, publishing, moderation …). Written only by the
// server; never readable from the browser (Firestore rules deny all).
// Summaries are short human-readable descriptions — never tokens, cookies,
// card data or other secrets.

export async function writeAudit(
  actor: SessionUser,
  entry: Pick<AuditEntry, "action" | "targetType" | "targetId" | "summary">,
): Promise<void> {
  try {
    await col("auditLogs").add({
      action: entry.action,
      actorId: actor.uid,
      actorEmail: actor.email,
      targetType: entry.targetType,
      targetId: entry.targetId,
      summary: entry.summary.slice(0, 300),
      at: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // Never fail the user's action because the log write failed; report it.
    console.error("[audit] write failed:", (error as Error)?.name, entry.action);
  }
}

export async function listAudit(options: { limit?: number; sinceDays?: number | null } = {}): Promise<AuditEntry[]> {
  let query = col("auditLogs").orderBy("at", "desc");
  if (options.sinceDays) query = query.where("at", ">=", new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000));
  const snapshot = await query.limit(options.limit ?? 50).get();
  return snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      action: String(d.action ?? ""),
      actorId: String(d.actorId ?? ""),
      actorEmail: typeof d.actorEmail === "string" ? d.actorEmail : null,
      targetType: d.targetType,
      targetId: String(d.targetId ?? ""),
      summary: String(d.summary ?? ""),
      at: toIso(d.at),
    };
  });
}
