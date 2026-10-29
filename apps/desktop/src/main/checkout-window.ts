import { BrowserWindow, shell } from "electron";
import { isCheckoutReturnUrl } from "./external-links.js";

type OpenCheckoutWindowOptions = {
  url: string;
  parent: BrowserWindow;
  appOrigin: string;
  /** Fired exactly once, when the payment flow ends (returned, or dismissed). */
  onReturn: () => void;
};

/**
 * Opens Stripe checkout (or the billing portal) in its own window.
 *
 * Deliberately built *without* the preload script: `window.desktop` exposes MCP
 * tool execution, the audit sink and notifications, and Stripe's page has no
 * business seeing any of it. It shares the default session, so when Stripe
 * redirects back to the app origin the Better Auth cookie is already there.
 *
 * Navigation inside this window is intentionally unrestricted — 3-D Secure
 * hands off to whichever domain the cardholder's bank uses, and blocking that
 * would break exactly the payments it is meant to protect.
 */
export function openCheckoutWindow({
  url,
  parent,
  appOrigin,
  onReturn,
}: OpenCheckoutWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    parent,
    width: 520,
    height: 760,
    title: "Keinsaas Navigator",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let returned = false;
  const finish = () => {
    if (returned) return;
    returned = true;
    onReturn();
  };

  const closeOnReturn = (_event: unknown, navigatedTo: string) => {
    if (!isCheckoutReturnUrl(navigatedTo, appOrigin)) return;
    // Stripe has sent the user back to us: the purchase is settled (or
    // cancelled) and the app window owns the rest of the flow.
    finish();
    if (!window.isDestroyed()) window.close();
  };

  window.webContents.on("did-navigate", closeOnReturn);
  window.webContents.on("did-navigate-in-page", closeOnReturn);

  // Some payment methods open a provider popup; those belong in the browser.
  window.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    void shell.openExternal(popupUrl);
    return { action: "deny" };
  });

  // Covers the user dismissing the window mid-flow, so the app still refreshes
  // rather than sitting on a stale balance.
  window.on("closed", finish);

  void window.loadURL(url);

  return window;
}
