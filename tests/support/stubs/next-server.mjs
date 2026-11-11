export async function connection() {}

// Outside a Next.js request scope `after` throws, so callers fall back to background work.
export function after() {
  throw new Error("after() called outside a request scope (test stub)");
}
