import { AppHeader } from "@/components/layouts/app-header";
import { AppSidebar } from "@/components/layouts/app-sidebar";
import { ViewportSync } from "@/components/layouts/viewport-sync";
import { cookies } from "next/headers";
import { SidebarProvider } from "ui/sidebar";

import { CloudProviders } from "@/components/gate/providers";
import { AppPopupProvider } from "@/components/layouts/app-popup-provider";
import { SWRConfigProvider } from "@/components/layouts/swr-config";
import { OnboardingCookieSync } from "@/components/onboarding/onboarding-cookie-sync";
import { COOKIE_KEY_SIDEBAR_STATE } from "lib/const";

import type { BasicUser } from "app-types/user";

/**
 * The authenticated application shell (sidebar, header, providers).
 *
 * Extracted from the `(chat)` layout so the pre-onboarding invitation route
 * can render the same surface behind its blocking dialog. The onboarding gate
 * stays in the layouts that own it — this component renders whatever it is
 * given.
 *
 * The usage-limit gate follows the same rule and lives in `(chat)/layout.tsx`.
 * It used to be mounted here, which trapped invited users: its dialog portal
 * stacked on top of the invitation dialog, and the limit it reported belonged
 * to the invitee's *personal* workspace — the very allowance that joining the
 * organization makes irrelevant. Any new authed surface that wants a spend gate
 * asks for it explicitly.
 */
export async function AppShell({
  user,
  syncOnboardingCookie = false,
  children,
}: {
  user: BasicUser;
  syncOnboardingCookie?: boolean;
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const isCollapsed =
    cookieStore.get(COOKIE_KEY_SIDEBAR_STATE)?.value !== "true";

  const content = (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <SWRConfigProvider user={user}>
        {syncOnboardingCookie && <OnboardingCookieSync />}
        <AppPopupProvider />
        <AppSidebar user={user} />
        {/* Sizes the shell to the visual viewport and locks document scrolling
              — see `viewport-sync.tsx`. */}
        <ViewportSync />
        {/* `overflow-hidden` clips absolutely-positioned descendants — the
              composer, drag overlay, gradients — to the area below the header,
              so nothing can paint in the header's row. `min-w-0` keeps this
              flex child from being widened by an over-wide descendant
              (diagrams, tables, long code lines) — without it a single wide
              message stretches the whole shell and the page can be swiped
              sideways on touch devices. `h-app-viewport` rather than `h-dvh`:
              on iOS the keyboard shrinks the visual viewport but not the layout
              one, and a `dvh` shell then hangs below the screen with the
              composer floating mid-page. */}
        <main className="relative bg-background w-full min-w-0 flex flex-col overflow-hidden h-app-viewport">
          <AppHeader />
          {/* The header is a sibling row, so this bounded region always
                starts below it. `overscroll-contain` stops an iOS rubber-band
                scroll inside the chat from chaining out here and dragging the
                content up behind the header; `overflow-x-hidden` clips the
                horizontal overflow the `min-w-0` above no longer propagates. */}
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain">
            {children}
          </div>
        </main>
      </SWRConfigProvider>
    </SidebarProvider>
  );

  // `AutumnProvider` lives inside `CloudProviders`: `app-sidebar-user.tsx`
  // calls `useCustomer()` unconditionally and the sidebar renders on every
  // authed route.
  return <CloudProviders user={user}>{content}</CloudProviders>;
}
