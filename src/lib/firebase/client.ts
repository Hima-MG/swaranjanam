import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence, type Auth } from "firebase/auth";

// NEXT_PUBLIC_* values are inlined at build time, so each must be referenced
// literally. These identify the project and are safe to ship to the browser;
// access is enforced by Firebase Auth and security rules.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseClientConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

let authPromise: Promise<Auth> | null = null;

/**
 * Lazily initialises Firebase Auth in the browser. Called only from event
 * handlers, so prerendering never touches Firebase.
 *
 * Persistence is in-memory: the client SDK is used only to sign in and obtain
 * an ID token. The HttpOnly session cookie set by the server is the single
 * source of truth for "who is logged in".
 */
export function getClientAuth(): Promise<Auth> {
  if (!isFirebaseClientConfigured()) {
    return Promise.reject(new Error("firebase/not-configured"));
  }
  authPromise ??= (async () => {
    const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    await setPersistence(auth, inMemoryPersistence);
    return auth;
  })();
  return authPromise;
}
