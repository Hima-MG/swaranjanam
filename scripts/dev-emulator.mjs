// Local, signed-in testing against the Firebase EMULATORS (never production).
//
//   1. Start the emulators:   npm run emulators   (Auth :9099, Firestore :8080, project demo-swaranjanam)
//   2. Seed test data:        npm run seed:emulator
//   3. Start the app:         npm run dev:emulator  (http://localhost:3100)
//
// This script overrides every Firebase connection setting so the app talks to
// the local emulators. Next.js does not let .env.local override variables
// that are already set, so the production values in .env.local are ignored.
// Cloudinary and Razorpay settings are NOT changed: do not upload media or pay
// while testing locally unless test credentials are configured.
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";

const PROJECT = "demo-swaranjanam";
const env = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_ADMIN_PROJECT_ID: PROJECT,
  // A throwaway key: the emulators accept any credential, and the real Admin key is never loaded.
  FIREBASE_ADMIN_CLIENT_EMAIL: `local@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_ADMIN_PRIVATE_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:demo",
};

// Refuse to start unless every Firebase setting points at the demo project.
for (const [key, value] of Object.entries({ FIREBASE_ADMIN_PROJECT_ID: env.FIREBASE_ADMIN_PROJECT_ID, NEXT_PUBLIC_FIREBASE_PROJECT_ID: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID })) {
  if (!String(value).startsWith("demo-")) throw new Error(`${key} must be a demo- project for emulator testing`);
}

const port = process.env.PORT || "3100";
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextBin, "dev", "--port", port], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
