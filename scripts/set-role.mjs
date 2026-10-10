#!/usr/bin/env node
/**
 * Trusted, server-side role management for Swaranjanam.
 *
 * This is the ONLY way to grant the teacher role. It runs locally (or in a
 * trusted shell) with the Firebase Admin service-account credentials; there is
 * deliberately no web endpoint or UI that can grant teacher access.
 *
 * Usage:
 *   npm run set-role -- <email> <teacher|student>
 *
 * The user must already have an account (register on the site first).
 * After a change the user's sessions are revoked; they must sign in again for
 * the new role to take effect.
 *
 * Credentials are read from .env.local (FIREBASE_ADMIN_*). Nothing secret is
 * printed.
 */
import nextEnv from "@next/env";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ROLES = ["student", "teacher"];
/** Claims granted before the role was renamed from admin to teacher. */
const TEACHER_CLAIMS = ["teacher", "admin"];

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const [email, requestedRole] = process.argv.slice(2);
if (!email || !requestedRole) fail("Usage: npm run set-role -- <email> <teacher|student>");
// `admin` is accepted as an alias so older instructions keep working.
const role = requestedRole === "admin" ? "teacher" : requestedRole;
if (!ROLES.includes(role)) fail(`Role must be one of: ${ROLES.join(", ")}`);

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()
  .replace(/^"|"$/g, "")
  .replace(/\\n/g, "\n");

const missing = [
  !projectId && "FIREBASE_ADMIN_PROJECT_ID",
  !clientEmail && "FIREBASE_ADMIN_CLIENT_EMAIL",
  !privateKey && "FIREBASE_ADMIN_PRIVATE_KEY",
].filter(Boolean);
if (missing.length) fail(`Missing environment variables: ${missing.join(", ")}`);

const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const auth = getAuth(app);
const db = getFirestore(app);

let user;
try {
  user = await auth.getUserByEmail(email.trim());
} catch (error) {
  if (error?.code === "auth/user-not-found") {
    fail(`No account found for ${email}. Ask the user to register on the site first.`);
  }
  fail(`Could not look up the user (${error?.code ?? "unknown error"}).`);
}

const previousRole = TEACHER_CLAIMS.includes(user.customClaims?.role) ? "teacher" : "student";

// 1. Custom claim — the source of truth checked by the server and security rules.
//    Other existing claims are preserved.
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role });

// 2. Mirror on the Firestore profile (merge: never overwrites other fields).
await db
  .collection("users")
  .doc(user.uid)
  .set({ role, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

// 3. Revoke existing sessions so the old role cannot keep being used.
await auth.revokeRefreshTokens(user.uid);

console.log(`\n✔ ${email}: role ${previousRole} → ${role}`);
console.log("  Existing sessions were revoked; the user must sign in again.\n");
process.exit(0);
