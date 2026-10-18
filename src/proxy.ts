import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

/**
 * Optimistic check only: sends visitors without a session cookie to /login
 * before any rendering work. It does NOT verify the cookie or the role — the
 * pages and route handlers do that on the server (see lib/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/teacher/:path*", "/admin/:path*", "/receipts/:path*"],
};
