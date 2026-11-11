// Test stub. Tests that exercise real Server Actions put a session cookie in
// globalThis.__testCookies ({ name: value }); otherwise there are no cookies.
export async function cookies() {
  return { get: (name) => (globalThis.__testCookies && name in globalThis.__testCookies ? { name, value: globalThis.__testCookies[name] } : undefined) };
}
export async function headers() {
  return new Headers();
}
