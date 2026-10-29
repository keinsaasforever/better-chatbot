/**
 * Where a navigation request from the app window should go.
 *
 * - `app`      — same origin as the web app; let it navigate in place.
 * - `download` — an app route that answers with a file, not a page; hand it
 *                to the session's download pipeline instead of a window.
 * - `checkout` — Stripe; belongs in a dedicated in-app window.
 * - `external` — anything else on the web; hand it to the system browser.
 * - `block`    — unparseable, or a scheme we refuse to hand anywhere.
 *
 * Identity providers (Google, GitHub, Microsoft) are deliberately *not* a
 * category of their own any more. They refuse OAuth inside embedded web views
 * (Google answers with `disallowed_useragent`), so the sign-in page never
 * navigates to them from inside the app: it asks the main process to open the
 * system browser and the session comes back through a `keinsaas://` deep link
 * (see ./desktop-auth.ts). Should a provider URL still reach this classifier,
 * `external` is the right answer.
 */
export type NavigationAction =
  | "app"
  | "download"
  | "checkout"
  | "external"
  | "block";

/**
 * App routes whose response is a file (or a redirect to one). Opened in a
 * window they show nothing — the body is an attachment — and, worse, the
 * window created for them stayed open and blank. See ./downloads.ts.
 */
const DOWNLOAD_PATHS = [
  /^\/api\/storage\/download$/,
  /^\/api\/projects\/[^/]+\/documents\/[^/]+\/download$/,
];

function isDownloadPath(pathname: string): boolean {
  return DOWNLOAD_PATHS.some((pattern) => pattern.test(pathname));
}

/** Whether a URL is one of the app's own file-download routes. */
export function isAppDownloadUrl(url: string, appOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === appOrigin && isDownloadPath(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Stripe hosts Autumn hands us: `checkout.stripe.com` for a purchase,
 * `billing.stripe.com` for the customer portal. These open in their own window
 * so the payment finishes inside the app and Stripe's return lands back on the
 * app origin (see ./checkout-window.ts).
 */
const CHECKOUT_DOMAIN = "stripe.com";

function isCheckoutHost(hostname: string): boolean {
  // Dot boundary, so `stripe.com.attacker.io` and `evil-stripe.com` do not match.
  return (
    hostname === CHECKOUT_DOMAIN || hostname.endsWith(`.${CHECKOUT_DOMAIN}`)
  );
}

export function classifyNavigation(
  url: string,
  appOrigin: string,
): NavigationAction {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "block";
  }

  if (parsed.origin === appOrigin) {
    return isDownloadPath(parsed.pathname) ? "download" : "app";
  }

  if (parsed.protocol === "https:" && isCheckoutHost(parsed.hostname)) {
    return "checkout";
  }

  if (
    parsed.protocol === "https:" ||
    parsed.protocol === "http:" ||
    parsed.protocol === "mailto:"
  ) {
    return "external";
  }

  return "block";
}

/**
 * Whether a URL reached inside the checkout window means the payment flow is
 * over and control belongs back in the app.
 *
 * The app origin covers the `successUrl` the renderer passes in the desktop
 * build. The marketing hosts are the fallback for a `success_url` configured in
 * the Autumn dashboard, which points at production even when the app itself is
 * running against localhost.
 */
const RETURN_HOSTS = new Set([
  "app.keinsaas.com",
  "www.keinsaas.com",
  "keinsaas.com",
]);

export function isCheckoutReturnUrl(url: string, appOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === appOrigin || RETURN_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
