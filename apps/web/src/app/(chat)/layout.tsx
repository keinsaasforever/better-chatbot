import { AppShell } from "@/components/layouts/app-shell";
import { UsageLimitGate } from "@/components/gate/usage-limit";
import { getSession } from "lib/auth/server";
import { userRepository } from "lib/db/repository";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// No `experimental_ppr` opt-in here: `experimental.ppr` is not enabled in
// next.config.ts, so the segment export was inert. Re-add it only alongside the
// config flag.

// MCP OAuth server actions run under this segment's config. Cap them at 60s so a
// stalled DB reservation or refresh lock fails fast instead of riding the 300s
// default function timeout. (/api/chat keeps its own longer budget.)
export const maxDuration = 60;

export default async function ChatLayout({
  children,
}: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }

  // Onboarding gate. The completion cookie is device-local, so on a brand-new
  // device fall back to ONE server-side DB read instead of bouncing the
  // browser through /onboarding → /api/onboarding/complete → / — the old
  // middleware cookie gate did exactly that, which users experienced as the
  // app loading twice on first open. When the DB already says "done" we
  // render immediately and let the client backfill the cookie.
  let syncOnboardingCookie = false;
  if (!cookieStore.get("onboarding_complete")) {
    const preferences = await userRepository.getPreferences(session.user.id);
    if (preferences?.onboarding?.step === "done") {
      syncOnboardingCookie = true;
    } else {
      redirect("/onboarding");
    }
  }

  // The credit nudge belongs to this surface, not to `AppShell` — mounting it
  // in the shell also covered `/accept-invitation/:id`, where the dialog
  // stopped invited users from ever joining the organization whose credits
  // would have replaced the exhausted personal allowance being reported.
  // `tests/auth/invite-callback.spec.ts` locks that down; keep both components
  // here rather than moving them into the shell.
  //
  // The modal itself is dismissible for the browser session: it is a nudge, and
  // actual spend enforcement is server-side (the credit guard, plus the 402
  // `CREDITS_EXHAUSTED` the chat routes return).
  //
  // Rendered after the onboarding gate so the `/onboarding` redirect path still
  // does not pay for the billing round trip.
  return (
    <AppShell user={session.user} syncOnboardingCookie={syncOnboardingCookie}>
      {children}
      <UsageLimitGate />
    </AppShell>
  );
}
