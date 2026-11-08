// Node module hooks for the unit and emulator tests (test-only; never used by the app).
//  * "@/x"          → src/x.ts | .tsx | /index.ts   (the tsconfig path alias)
//  * "server-only"  → empty stub (the guard only matters inside Next.js)
//  * "next/headers", "next/navigation", "next/server", "next/cache"
//                   → small stubs: the modules under test import them but the
//                     tested functions never call them.
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = (name) => pathToFileURL(join(root, "tests", "support", "stubs", `${name}.mjs`)).href;
const STUBS = {
  "server-only": stub("empty"),
  "next/headers": stub("next-headers"),
  "next/navigation": stub("next-navigation"),
  "next/server": stub("next-server"),
  "next/cache": stub("next-cache"),
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const base = join(root, "src", specifier.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
