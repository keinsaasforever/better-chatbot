import { NextResponse } from "next/server";
import { BASE_URL } from "lib/const";

/**
 * GET /api/onboarding/complete
 *
 * Sets the onboarding_complete cookie and redirects to /.
 * Called by the onboarding page server component when the DB already
 * marks the user as done — cookies can only be written in Route Handlers
 * or Server Actions, not in Server Components.
 */
export async function GET() {
  const response = NextResponse.redirect(`${BASE_URL}/`);

  response.cookies.set("onboarding_complete", "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });

  return response;
}
