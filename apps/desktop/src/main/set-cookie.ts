/**
 * Minimal `Set-Cookie` parser for the fallback in ./desktop-auth.ts, which
 * applies the session cookie by hand if Chromium's network stack did not store
 * it from the one-time-token exchange. Pure module, unit-tested.
 */
export type ParsedSetCookie = {
  name: string;
  value: string;
  path?: string;
  secure: boolean;
  httpOnly: boolean;
  /** Seconds since the epoch, as Electron's `cookies.set` expects. */
  expirationDate?: number;
};

export function parseSetCookie(header: string): ParsedSetCookie | null {
  const [pair, ...attributes] = header.split(";");
  const separator = pair?.indexOf("=") ?? -1;
  if (!pair || separator <= 0) return null;

  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (!name) return null;

  const cookie: ParsedSetCookie = {
    name,
    value,
    secure: false,
    httpOnly: false,
  };

  for (const attribute of attributes) {
    const eq = attribute.indexOf("=");
    const key = (eq === -1 ? attribute : attribute.slice(0, eq))
      .trim()
      .toLowerCase();
    const raw = eq === -1 ? "" : attribute.slice(eq + 1).trim();

    switch (key) {
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "path":
        if (raw) cookie.path = raw;
        break;
      case "max-age": {
        const seconds = Number.parseInt(raw, 10);
        if (Number.isFinite(seconds)) {
          cookie.expirationDate = Math.floor(Date.now() / 1000) + seconds;
        }
        break;
      }
      case "expires": {
        if (cookie.expirationDate !== undefined) break; // Max-Age wins
        const at = Date.parse(raw);
        if (Number.isFinite(at)) cookie.expirationDate = Math.floor(at / 1000);
        break;
      }
      default:
        break;
    }
  }

  return cookie;
}
