import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicAuthPath, signInRedirectPath } from "@/lib/auth/public-routes";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
  REFERRAL_QUERY_PARAM,
  isValidReferralCode,
} from "@/lib/referral/constants";

const BOOT_VISIT_COOKIE = "__boot_visit";
const BOOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BootDocumentContext = {
  documentId: string;
  visitId: string;
  isNewVisit: boolean;
  requestHeaders: Headers;
};

function createBootDocumentContext(
  request: NextRequest,
): BootDocumentContext | null {
  if (
    process.env.BOOT_DIAGNOSTICS !== "1" ||
    request.headers.get("sec-fetch-dest") !== "document"
  ) {
    return null;
  }

  const existingVisitId = request.cookies.get(BOOT_VISIT_COOKIE)?.value;
  const isValidVisitId =
    existingVisitId !== undefined && BOOT_ID_PATTERN.test(existingVisitId);
  const visitId = isValidVisitId ? existingVisitId : crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-boot-visit-id", visitId);
  requestHeaders.set("x-boot-document-id", documentId);

  return {
    documentId,
    visitId,
    isNewVisit: !isValidVisitId,
    requestHeaders,
  };
}

function safeReferrer(value: string | null): string {
  if (!value) return "(none)";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "(invalid)";
  }
}

function finishDocumentResponse(
  response: NextResponse,
  request: NextRequest,
  boot: BootDocumentContext | null,
  outcome: "next" | "redirect",
  sessionCookiePresent: boolean | null,
  location?: string,
) {
  if (!boot) return response;

  response.cookies.set(BOOT_VISIT_COOKIE, boot.visitId, {
    httpOnly: true,
    maxAge: 30 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.headers.set("x-boot-document-id", boot.documentId);
  response.headers.set("x-boot-visit-id", boot.visitId);

  console.info("[boot] document", {
    event: "document",
    at: new Date().toISOString(),
    visitId: boot.visitId,
    documentId: boot.documentId,
    isNewVisit: boot.isNewVisit,
    pathname: request.nextUrl.pathname,
    outcome,
    location: location ?? null,
    sessionCookiePresent,
    secFetchSite: request.headers.get("sec-fetch-site") ?? "(none)",
    secFetchMode: request.headers.get("sec-fetch-mode") ?? "(none)",
    secFetchUser: request.headers.get("sec-fetch-user") ?? "(none)",
    purpose:
      request.headers.get("purpose") ??
      request.headers.get("sec-purpose") ??
      "(none)",
    cacheControl: request.headers.get("cache-control") ?? "(none)",
    serviceWorkerNavigationPreload:
      request.headers.get("service-worker-navigation-preload") ?? "(none)",
    referer: safeReferrer(request.headers.get("referer")),
    mobile: request.headers.get("sec-ch-ua-mobile") ?? "(unknown)",
    platform: request.headers.get("sec-ch-ua-platform") ?? "(unknown)",
    userAgent: request.headers.get("user-agent")?.slice(0, 160) ?? "(none)",
    vercelRequestId: request.headers.get("x-vercel-id") ?? "(none)",
  });

  return response;
}

/**
 * Persist a `?ref=` referral code so it survives sign-up.
 *
 * It cannot simply ride along in the URL: `signInRedirectPath` returns a bare
 * "/sign-in" for the landing page (`pathname === "/"`), dropping the query
 * string — and that is exactly where referral links point. `sameSite: "lax"`
 * keeps the cookie attached through the OAuth round trip, which returns as a
 * top-level GET to our own origin.
 *
 * Last click wins. The code is not signed: Autumn validates it, so a forged one
 * is worthless and a borrowed valid one is indistinguishable from clicking that
 * person's link anyway.
 */
function captureReferralCode(
  response: NextResponse,
  request: NextRequest,
): NextResponse {
  const code = request.nextUrl.searchParams.get(REFERRAL_QUERY_PARAM);
  if (!isValidReferralCode(code)) return response;

  response.cookies.set(REFERRAL_COOKIE, code as string, {
    httpOnly: true,
    maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const boot = createBootDocumentContext(request);
  const next = (sessionCookiePresent: boolean | null = null) =>
    captureReferralCode(
      finishDocumentResponse(
        NextResponse.next(
          boot ? { request: { headers: boot.requestHeaders } } : undefined,
        ),
        request,
        boot,
        "next",
        sessionCookiePresent,
      ),
      request,
    );
  const redirect = (
    destination: string,
    sessionCookiePresent: boolean | null,
  ) =>
    captureReferralCode(
      finishDocumentResponse(
        NextResponse.redirect(new URL(destination, request.url)),
        request,
        boot,
        "redirect",
        sessionCookiePresent,
        destination,
      ),
      request,
    );

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname === "/admin") {
    return redirect("/admin/users", null);
  }

  // Allow scheduled task requests through when the shared secret is configured
  // and valid. The route handler performs its own user-level validation.
  const scheduledTaskSecret = process.env.SCHEDULED_TASK_SECRET;
  if (
    scheduledTaskSecret &&
    request.headers.get("X-Scheduled-Task-Auth") === scheduledTaskSecret
  ) {
    return next();
  }

  // Inbound webhooks authenticate via signature verification inside the
  // route handlers — they never carry a session cookie.
  if (pathname.startsWith("/api/webhooks/")) {
    return next();
  }

  // The Navigator MCP server authenticates every request itself (a bearer API
  // key, or a same-origin session cookie) and answers a missing credential
  // with a 401 MCP auth challenge. A redirect to /sign-in would break every
  // MCP client, which never carries the session cookie.
  if (pathname === "/api/navigator-mcp") {
    return next();
  }

  // The endpoint validates a same-origin diagnostic cookie and a strict body
  // schema. It must remain reachable before authentication so sign-in loads
  // can report their client lifecycle.
  if (pathname === "/api/_boot") {
    return next();
  }

  const publicVoiceDeviceApiPaths = new Set([
    "/api/voice/devices/register",
    "/api/voice/devices/complete-registration",
    "/api/voice/devices/ws",
    "/api/voice/transcript",
    "/api/voice/audio-command",
    "/api/voice/xiaozhi/ota",
    "/api/voice/xiaozhi/ota/activate",
    "/api/voice/xiaozhi/activate",
  ]);

  if (publicVoiceDeviceApiPaths.has(pathname)) {
    return next();
  }

  const sessionCookie = getSessionCookie(request);
  const sessionCookiePresent = Boolean(sessionCookie);

  // Include public auth pages in the matcher so their document requests get
  // their own document ID and can be paired with the redirect that led there.
  if (isPublicAuthPath(pathname)) {
    return next(sessionCookiePresent);
  }

  if (!sessionCookie) {
    // Carry the requested page as `callbackUrl` instead of dropping it. An
    // invited user opening /accept-invitation/:id signs in (or signs up) and
    // lands back on the invitation, which is why that route needs no
    // exemption of its own.
    return redirect(
      signInRedirectPath(pathname, request.nextUrl.search),
      false,
    );
  }

  // The onboarding gate lives in the (chat) layout now. The old cookie-based
  // middleware gate bounced every NEW device through /onboarding →
  // /api/onboarding/complete → / (three redirects), which users saw as the
  // app loading twice on first open.
  return next(true);
}

export const config = {
  matcher: [
    // `p` is the published-page surface: readable by anyone holding the slug,
    // so it must not bounce anonymous visitors to /sign-in. The lookahead
    // anchors at the path start, so this exempts only top-level /p/* — every
    // /api/* route, including the publish and revoke endpoints, stays guarded.
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/auth|api/inngest|export|p/).*)",
  ],
};
