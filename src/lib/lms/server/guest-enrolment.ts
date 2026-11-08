import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { ensureUserProfile } from "@/lib/auth/profile";
import type { SessionUser } from "@/lib/auth/session";
import { siteConfig } from "@/config/site";
import { getAdminAuth } from "@/lib/firebase/admin";
import { ENROLMENT_TYPE_LABELS, isSharedEnrolment, istToday, learnerNamesLabel, parseRegistrationDetails, type RegistrationStatus } from "@/lib/lms/registration";
import { AccessError } from "@/lib/lms/server/access";
import { col, db } from "@/lib/lms/server/db";
import { grantProgrammeAccess } from "@/lib/lms/server/class-billing";
import { assertProgrammePlace, mapRegistration, openCourseForRegistration, priceEnrolment, registrationPricingFields, type RegistrationRecord } from "@/lib/lms/server/registrations";

// Guest enrolment (signed-out visitors) and student account provisioning.
//
// 1. A visitor registers with their email (registrations/g_{hash(email)}_{slug}).
//    The browser holds a random checkout token (HttpOnly cookie); only its
//    SHA-256 hash is stored. The token lets that browser review, pay and see the
//    status of its own registration — nothing else.
// 2. Payment goes through the existing Razorpay flow; the registration becomes
//    "paid" ONLY after server-side verification (gateway.ts).
// 3. After the verified payment, the server provisions the account (Admin SDK):
//      * no Firebase account for the email → a student account is created
//        (role "student" server-side; never from the browser), linked to the
//        registration, and Firebase emails a password-setup link (time-limited,
//        single-use, no password in the email);
//      * an account already exists → NO second account; the registration waits
//        ("linkPending") until the owner signs in with that email (verified),
//        which links it (claimGuestRegistrations).
//    Provisioning is idempotent (webhook + checkout + scheduled retry).

type Actor = { uid: string; email: string | null };
const entry = (actor: Actor, change: string) => ({ at: Timestamp.now(), by: actor.uid, byEmail: actor.email, change });
const SYSTEM: Actor = { uid: "enrolment", email: null };
const SLUG = /^[a-z0-9-]{1,80}$/;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Inside a transaction (reads first): the registration's verified payment and
 * its receipt, so linking can give them to the student (payment history).
 */
async function readPaymentDocs(tx: FirebaseFirestore.Transaction, paymentId: string | null) {
  if (!paymentId) return [];
  const refs = [col("payments").doc(paymentId), col("receipts").doc(paymentId)];
  return (await tx.getAll(...refs)).filter((d) => d.exists).map((d) => d.ref);
}

/**
 * One guest registration per login email and course (deterministic id → no
 * duplicates). Two people learning together use ONE registration (Learn Together).
 */
export function guestRegistrationId(email: string, slug: string): string {
  return `g_${sha(email.trim().toLowerCase()).slice(0, 32)}_${slug}`;
}

/** The uid the academy gives a student account it creates for this email (stable → retries never duplicate). */
export function provisionedUid(email: string): string {
  return `st_${sha(`student:${email.trim().toLowerCase()}`).slice(0, 26)}`;
}

function tokenMatches(stored: unknown, presented: unknown): boolean {
  if (typeof stored !== "string" || typeof presented !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(presented)) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(sha(presented), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The guest's own registration, only with the matching checkout token. */
export async function readGuestRegistration(registrationId: unknown, token: unknown): Promise<RegistrationRecord | null> {
  if (typeof registrationId !== "string" || !/^g_[a-f0-9]{32}_[a-z0-9-]{1,80}$/.test(registrationId)) return null;
  const snap = await col("registrations").doc(registrationId).get();
  if (!snap.exists || !tokenMatches(snap.get("guestTokenHash"), token)) return null;
  return mapRegistration(snap);
}

/**
 * Creates or updates a guest registration while its initial payment is still
 * awaited. Returns the checkout token to keep in the browser. Without the
 * current token (e.g. another browser), a pending registration is re-issued
 * with a new token; a paid one cannot be changed.
 */
export async function saveGuestRegistration(
  input: { slug: unknown; mode: unknown; details: unknown },
  presentedToken: unknown,
  nowIso = new Date().toISOString(),
): Promise<{ registrationId: string; token: string; initialAmountMinor: number; outcome: "created" | "updated" }> {
  if (typeof input?.slug !== "string" || !SLUG.test(input.slug)) throw new AccessError("That course could not be found.");
  const course = await openCourseForRegistration(input.slug);
  // Server-side price (never from the browser): the course's rate, or the fixed Learn Together rates.
  const priced = priceEnrolment(course, input?.mode);
  const { value: details, errors } = parseRegistrationDetails((input?.details ?? {}) as Record<string, unknown>, istToday(nowIso), {
    shared: isSharedEnrolment(priced.enrolmentType),
    fixedSchedule: priced.special,
  });
  if (!details) throw new AccessError("Please fix the highlighted fields.", errors);
  const id = guestRegistrationId(details.email, course.slug);
  const ref = col("registrations").doc(id);
  if (priced.special) await assertProgrammePlace(course, id);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = mapRegistration(snap);
    if (current && current.status !== "pending_payment" && current.status !== "cancelled") {
      throw new AccessError("This email is already registered and paid for this course. Check your email, or sign in to see your enrolment.");
    }
    const keep = current !== null && tokenMatches(snap.get("guestTokenHash"), presentedToken);
    const token = keep ? (presentedToken as string) : randomBytes(32).toString("base64url");
    const fields = {
      guest: true,
      studentId: null,
      guestEmail: details.email,
      guestTokenHash: sha(token),
      studentEmail: details.email,
      ...registrationPricingFields(course, priced),
      details,
      status: "pending_payment" satisfies RegistrationStatus,
      paymentId: null,
      paidAt: null,
      batchId: null,
      accountId: null,
      confirmedSchedule: null,
      linkPending: false,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const change = `${current ? "Updated" : "Submitted"} guest registration (${priced.special ? "Special Programme" : ENROLMENT_TYPE_LABELS[priced.enrolmentType]})${current && !keep ? " from a new browser" : ""}; ${priced.special ? "full fee" : "initial payment"} ₹${priced.sessionMinor / 100} awaited`;
    if (current) tx.update(ref, { ...fields, history: FieldValue.arrayUnion(entry(SYSTEM, change)) });
    else tx.create(ref, { ...fields, createdAt: FieldValue.serverTimestamp(), history: [entry(SYSTEM, change)] });
    return { registrationId: id, token, initialAmountMinor: priced.sessionMinor, outcome: current ? ("updated" as const) : ("created" as const) };
  });
}

// --- Invitation email (Firebase's own password-setup email) ----------------------------------------------------

/**
 * Asks Firebase Authentication to email a password-setup link (its built-in
 * "reset password" template: time-limited, single-use; no password is sent).
 * Returns false when it cannot be sent (no web API key configured, or Firebase
 * refused); the student can still use "Forgot password" on the login page.
 */
export async function sendPasswordSetupEmail(email: string): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return false;
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
  const base = emulator ? `http://${emulator}/identitytoolkit.googleapis.com/v1` : "https://identitytoolkit.googleapis.com/v1";
  const send = (withContinue: boolean) =>
    fetch(`${base}/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email, ...(withContinue ? { continueUrl: `${siteConfig.url}/login?next=/dashboard` } : {}) }),
    });
  try {
    let res = await send(true);
    // An unauthorised continue URL (domain not listed in Firebase) must not stop the invitation.
    if (!res.ok) res = await send(false);
    return res.ok;
  } catch (error) {
    console.error("[enrolment] invitation email failed:", (error as Error)?.name);
    return false;
  }
}

// --- Account provisioning after a verified payment ----------------------------------------------------------------

export type ProvisionOutcome = "created" | "linked" | "pending_existing_account" | "not_applicable";

/**
 * After the initial payment of a GUEST registration has been verified: create
 * the student account (or detect an existing one) and link the registration.
 * Idempotent and safe to repeat (checkout, webhook and the scheduled retry).
 */
export async function provisionRegistrationAccount(registrationId: string): Promise<ProvisionOutcome> {
  const ref = col("registrations").doc(registrationId);
  const snap = await ref.get();
  const registration = mapRegistration(snap);
  if (!registration || snap.get("guest") !== true || registration.status !== "paid") return "not_applicable";
  if (registration.studentId) return "not_applicable";
  const email = String(snap.get("guestEmail") ?? "");
  if (!email) return "not_applicable";
  const auth = getAdminAuth();
  const expectedUid = provisionedUid(email);

  let uid: string | null = null;
  let created = false;
  try {
    const existing = await auth.getUserByEmail(email);
    // Our own earlier attempt (same deterministic uid) counts as ours; any other account is the owner's.
    if (existing.uid === expectedUid) uid = existing.uid;
  } catch (error) {
    if ((error as { code?: string })?.code !== "auth/user-not-found") throw error;
    try {
      const user = await auth.createUser({ uid: expectedUid, email, emailVerified: false, displayName: registration.details.fullName.slice(0, 100) || undefined, disabled: false });
      uid = user.uid;
      created = true;
    } catch (createError) {
      const code = (createError as { code?: string })?.code;
      // A concurrent attempt created it first: it is ours if it has our uid.
      if (code !== "auth/uid-already-exists" && code !== "auth/email-already-exists") throw createError;
      const again = await auth.getUserByEmail(email);
      if (again.uid === expectedUid) uid = again.uid;
    }
  }

  if (!uid) {
    // An account already exists for this email: never a second account. It is linked when its owner signs in.
    if (snap.get("linkPending") !== true) {
      await ref.update({ linkPending: true, updatedAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion(entry(SYSTEM, "Payment verified; an account already exists for this email — waiting for its owner to sign in")) });
    }
    return "pending_existing_account";
  }

  // ONE login for the enrolment (Learn Together: both learners share it). Role is never stored
  // from the browser: no custom claim = student; the profile is always "student".
  const d = registration.details;
  await ensureUserProfile({ uid, email, displayName: learnerNamesLabel(d.learners.map((l) => l.fullName)) || d.fullName, phone: d.mobile, provider: "invite" });
  const linked = await linkRegistrationTo(ref, uid, created ? "Student account created for the registration email" : "Linked to the student account created for this email");
  // One invitation per login (a second course for the same email does not send another).
  const holder = await col("users").doc(uid).get();
  if (linked && holder.get("inviteSentAt") == null) {
    const sent = await sendPasswordSetupEmail(email);
    if (sent) await holder.ref.set({ inviteSentAt: FieldValue.serverTimestamp() }, { merge: true });
    await ref.update({ inviteSentAt: sent ? FieldValue.serverTimestamp() : null, inviteStatus: sent ? "sent" : "not_sent" });
  } else if (linked) {
    await ref.update({ inviteStatus: "sent" });
  }
  return created ? "created" : "linked";
}

/**
 * Links a paid guest registration to its student login (and the payment +
 * receipt, so they appear in that student's history). Returns false when it was
 * already linked.
 */
async function linkRegistrationTo(ref: FirebaseFirestore.DocumentReference, uid: string, change: string): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (fresh.get("studentId")) return false;
    const owned = await readPaymentDocs(tx, str(fresh.get("paymentId")));
    for (const doc of owned) tx.update(doc, { studentId: uid, learnerIds: [uid] });
    // Special Programme: the payment was verified before linking, so access starts now.
    if (fresh.get("kind") === "special" && fresh.get("status") === "paid") {
      grantProgrammeAccess(tx, { courseId: String(fresh.get("courseId") ?? ""), studentId: uid, registrationId: ref.id, by: SYSTEM.uid });
    }
    tx.update(ref, {
      studentId: uid,
      linkPending: false,
      accountProvisionedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(entry(SYSTEM, change)),
    });
    return true;
  });
}

/** Retries provisioning for paid guest registrations that are not linked yet (scheduled job). */
export async function provisionPendingRegistrations(): Promise<{ attempted: number; errors: number }> {
  const snap = await col("registrations").where("guest", "==", true).where("status", "==", "paid").get();
  let attempted = 0;
  let errors = 0;
  for (const doc of snap.docs) {
    if (doc.get("studentId") || doc.get("linkPending") === true) continue;
    attempted += 1;
    try {
      await provisionRegistrationAccount(doc.id);
    } catch (error) {
      errors += 1;
      console.error("[enrolment] provisioning failed:", doc.id, (error as Error)?.message);
    }
  }
  return { attempted, errors };
}

/**
 * Links paid guest registrations made with this email to the signed-in student
 * — only when Firebase has verified that they own the email.
 */
export async function claimGuestRegistrations(user: SessionUser): Promise<number> {
  if (user.role !== "student" || !user.email || user.emailVerified !== true) return 0;
  const email = user.email.toLowerCase();
  const snap = await col("registrations").where("guestEmail", "==", email).where("status", "==", "paid").get();
  let claimed = 0;
  for (const doc of snap.docs) {
    if (doc.get("studentId") || doc.get("guestEmail") !== email) continue;
    const ok = await linkRegistrationTo(doc.ref, user.uid, "Linked to the existing student account (signed in with the verified email)");
    if (ok) claimed += 1;
  }
  return claimed;
}

/**
 * Asks Firebase to email the signed-in student an email-verification link (its
 * built-in template). Server-side: a short-lived custom token is exchanged for
 * an ID token of THIS user only; nothing is returned to the browser.
 */
export async function sendVerificationEmailFor(user: SessionUser): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (user.role !== "student" || !user.email || user.emailVerified || !apiKey) return false;
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
  const base = emulator ? `http://${emulator}/identitytoolkit.googleapis.com/v1` : "https://identitytoolkit.googleapis.com/v1";
  try {
    const customToken = await getAdminAuth().createCustomToken(user.uid);
    const signIn = await fetch(`${base}/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!signIn.ok) return false;
    const { idToken } = (await signIn.json()) as { idToken?: string };
    if (!idToken) return false;
    const res = await fetch(`${base}/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken }),
    });
    return res.ok;
  } catch (error) {
    console.error("[enrolment] verification email failed:", (error as Error)?.name);
    return false;
  }
}
