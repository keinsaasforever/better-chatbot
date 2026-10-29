import {
  DesktopHandoff,
  DesktopHandoffInvalid,
} from "@/components/auth/desktop-handoff";
import { auth } from "auth/server";
import {
  DESKTOP_HANDOFF_PATH,
  buildDesktopCallbackUrl,
  isValidDesktopState,
} from "lib/auth/desktop-handoff";
import { signInRedirectPath } from "lib/auth/public-routes";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// Mints a fresh one-time token per request; never cache this page.
export const dynamic = "force-dynamic";

/**
 * Where the system browser lands after a sign-in started from the desktop
 * app. The middleware already bounced anonymous visitors to /sign-in with this
 * URL (including `state`) as the callback, so by the time this renders there
 * is a session to hand over.
 */
export default async function DesktopAuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const { state } = await searchParams;
  if (!isValidDesktopState(state)) {
    return <DesktopHandoffInvalid />;
  }

  const token = await mintOneTimeToken();
  if (!token) {
    // Session vanished between the middleware and here (signed out in another
    // tab, expired). Back through sign-in, keeping the state.
    redirect(
      signInRedirectPath(
        DESKTOP_HANDOFF_PATH,
        `?state=${encodeURIComponent(state)}`,
      ),
    );
  }

  return (
    <DesktopHandoff deepLink={buildDesktopCallbackUrl({ token, state })} />
  );
}

async function mintOneTimeToken(): Promise<string | null> {
  try {
    const { token } = await auth.api.generateOneTimeToken({
      headers: await headers(),
    });
    return token;
  } catch {
    return null;
  }
}
