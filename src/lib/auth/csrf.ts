import "server-only";

/**
 * CSRF protection for state-changing auth endpoints (defence in depth on top
 * of SameSite=Lax cookies):
 *
 * 1. `Sec-Fetch-Site`, when the browser sends it, must be `same-origin`.
 * 2. `Origin` must be present and its host must equal the host the request
 *    was sent to (`X-Forwarded-Host` behind Vercel/proxies, else `Host`) —
 *    the same rule Next.js applies to Server Actions — or match
 *    NEXT_PUBLIC_SITE_URL.
 * 3. The body must be JSON. Cross-site forms cannot send `application/json`
 *    without a CORS preflight, which these routes never approve.
 *
 * `request.url` is deliberately not used: Next.js normalises it (e.g. to
 * `localhost`), so it does not reflect the host the browser actually used.
 *
 * Returns an error Response when the request must be rejected, else null.
 */
export function rejectCrossSiteRequest(request: Request): Response | null {
  const forbidden = () => Response.json({ error: "Cross-site request rejected" }, { status: 403 });

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return forbidden();

  const origin = request.headers.get("origin");
  if (!origin || !isAllowedOrigin(request, origin)) return forbidden();

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }

  return null;
}

function isAllowedOrigin(request: Request, origin: string): boolean {
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  // The first X-Forwarded-Host entry is the host the browser requested.
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (originHost === forwardedHost || originHost === host) return true;

  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin === new URL(origin).origin;
    } catch {
      // Ignore a malformed NEXT_PUBLIC_SITE_URL rather than failing every login.
    }
  }
  return false;
}
