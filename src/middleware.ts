import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // 1. Core Production Security Headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // 2. Strict Transport Security (HSTS) in Production
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  // 3. Content Security Policy (defense against XSS, clickjacking, code injection)
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: pbs.twimg.com abs.twimg.com unavatar.io",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", cspHeader);

  // 4. CSRF / Origin Verification for State-Changing API Endpoints
  const method = request.method.toUpperCase();
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/") && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const isWebhookOrCron = pathname.startsWith("/api/cron/") || pathname.startsWith("/api/sync");

    if (!isWebhookOrCron) {
      const origin = request.headers.get("origin");
      const referer = request.headers.get("referer");
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";

      const sourceHeader = origin || referer;
      if (sourceHeader) {
        try {
          const sourceUrl = new URL(sourceHeader);
          const isAllowedCrossHost =
            sourceUrl.host === host ||
            (sourceUrl.host.includes("vercel.app") && host.includes("onrender.com")) ||
            (sourceUrl.host.includes("onrender.com") && host.includes("vercel.app")) ||
            sourceUrl.host.includes("veilx.cash") ||
            host.includes("veilx.cash");

          if (host && !isAllowedCrossHost) {
            return new NextResponse(
              JSON.stringify({ error: "CSRF_FORBIDDEN: Cross-origin state mutating request blocked." }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }
        } catch {
          return new NextResponse(
            JSON.stringify({ error: "INVALID_ORIGIN: Malformed origin/referer header." }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
