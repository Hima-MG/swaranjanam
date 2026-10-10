import "server-only";

/**
 * CSRF protection for state-changing auth endpoints (defence in depth on top
 * of SameSite=Lax cookies):
 *
 * 1. `Sec-Fetch-Site`, when the browser sends it, must be `same-origin`.
 * 2. `Origin` must be present and match this deployment's origin.
 * 3. The body must be JSON. Cross-site forms cannot send `application/json`
 *    without a CORS preflight, which these routes never approve.
 *
 * Returns an error Response when the request must be rejected, else null.
 */
export function rejectCrossSiteRequest(request: Request): Response | null {
  const forbidden = () => Response.json({ error: "Cross-site request rejected" }, { status: 403 });

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return forbidden();

  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(request).has(origin)) return forbidden();

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }

  return null;
}

function allowedOrigins(request: Request): Set<string> {
  const origins = new Set([new URL(request.url).origin]);
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      // Ignore a malformed NEXT_PUBLIC_SITE_URL rather than failing every login.
    }
  }
  return origins;
}
