import "server-only";

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/** Thrown when Admin credentials are missing or malformed. Never contains values. */
export class AdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

const APP_NAME = "swaranjanam-admin";

function readCredentials() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  const missing = [
    !projectId && "FIREBASE_ADMIN_PROJECT_ID",
    !clientEmail && "FIREBASE_ADMIN_CLIENT_EMAIL",
    !rawKey?.trim() && "FIREBASE_ADMIN_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    // Report variable *names* only.
    throw new AdminConfigError(`Missing Firebase Admin environment variables: ${missing.join(", ")}`);
  }

  // Accept both real newlines and escaped "\n" sequences (as stored by Vercel),
  // and tolerate surrounding quotes left over from copy-paste.
  const privateKey = rawKey!
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");
  if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
    throw new AdminConfigError("FIREBASE_ADMIN_PRIVATE_KEY is not a valid PEM private key");
  }

  return { projectId: projectId!, clientEmail: clientEmail!, privateKey };
}

/** Lazily initialises the Admin app so builds succeed without credentials. */
function getAdminApp(): App {
  if (getApps().some((app) => app.name === APP_NAME)) {
    return getApp(APP_NAME);
  }
  return initializeApp({ credential: cert(readCredentials()) }, APP_NAME);
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
