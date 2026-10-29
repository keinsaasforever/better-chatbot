/**
 * The desktop shell's sign-in bridge, when the page runs inside Electron.
 *
 * Providers refuse OAuth in embedded web views, so inside the desktop app a
 * social sign-in must go through the system browser (see
 * `apps/desktop/src/main/desktop-auth.ts`). Desktop builds that predate the
 * bridge return `undefined` here and keep today's in-window behaviour.
 */
export type DesktopAuthBridge = NonNullable<
  NonNullable<Window["desktop"]>["auth"]
>;

export function getDesktopAuthBridge(): DesktopAuthBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = window.desktop?.auth;
  if (!bridge || typeof bridge.startBrowserSignIn !== "function") {
    return undefined;
  }
  return bridge;
}
