/**
 * Placeholder expansion for stored site credentials, and the origin binding
 * that makes it safe.
 *
 * Deliberately free of `server-only` and of any Kernel import, the same way
 * `browser-contract.ts` is: this is the security-critical part of the feature,
 * so it has to be testable in isolation. `playwright-execute-tool.ts` is the
 * only caller.
 */

/** What the inner agent writes, e.g. `{{cred:emta.password}}`. */
export const CREDENTIAL_PLACEHOLDER_PATTERN =
  /\{\{cred:([a-zA-Z0-9_.-]{1,64})\.([a-zA-Z0-9_]{1,64})\}\}/g;

/** The slice of a resolved credential this module needs. */
export type PlaceholderCredential = {
  alias: string;
  domain: string;
  allowedUrlPrefix: string | null;
  fields: Record<string, string>;
};

/** Outcome of expanding placeholders in one snippet. */
export type PlaceholderResolution =
  | { ok: true; code: string; usedAliases: string[] }
  | { ok: false; error: string };

/**
 * Whether a page URL is inside a credential's registrable domain.
 *
 * Suffix match on a dot boundary, so `mta.ee` covers `www.mta.ee` and does NOT
 * cover `evilmta.ee` — anyone can register a lookalike, and it must not inherit
 * the binding. Scheme is pinned to https for the same reason: a downgrade would
 * put the value on the wire in clear.
 */
export function isOriginAllowed(
  pageUrl: string,
  credential: Pick<PlaceholderCredential, "domain" | "allowedUrlPrefix">,
): boolean {
  if (credential.allowedUrlPrefix) {
    return pageUrl.startsWith(credential.allowedUrlPrefix);
  }
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  const domain = credential.domain.toLowerCase().replace(/^\.+/, "");
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Substitute credential placeholders, or refuse.
 *
 * `pageUrl` is where the browser actually is, established by asking the browser
 * rather than the model. That check is the load-bearing security control in
 * this whole feature, not a nicety:
 *
 * The inner agent reads page content by design, and an LLM cannot distinguish
 * page content from instructions. Without the origin check, any page the agent
 * visits could tell it to navigate elsewhere and fill
 * `{{cred:emta.password}}` into an attacker's form, and the agent would comply.
 * With it, the placeholder is inert everywhere except the one origin a human
 * registered against that credential, so the injection has nothing to harvest.
 *
 * Do not "simplify" this away, and never let the agent supply the origin.
 */
export function resolveCredentialPlaceholders(input: {
  code: string;
  credentials: PlaceholderCredential[];
  pageUrl: string;
}): PlaceholderResolution {
  const usedAliases = new Set<string>();
  let failure: string | null = null;

  const code = input.code.replace(
    CREDENTIAL_PLACEHOLDER_PATTERN,
    (match, alias: string, field: string) => {
      const credential = input.credentials.find((c) => c.alias === alias);
      if (!credential) {
        failure ??= `No credential "${alias}" is available on this run. Available: ${
          input.credentials.map((c) => c.alias).join(", ") || "none"
        }.`;
        return match;
      }
      const value = credential.fields[field];
      if (value === undefined) {
        failure ??= `Credential "${alias}" has no field "${field}". It has: ${
          Object.keys(credential.fields).join(", ") || "none"
        }.`;
        return match;
      }
      if (!isOriginAllowed(input.pageUrl, credential)) {
        failure ??= `Credential "${alias}" may only be used on ${credential.domain}, and the browser is on ${input.pageUrl}. Navigate to the right site first, or call report_blocked.`;
        return match;
      }
      usedAliases.add(alias);
      return value;
    },
  );

  // A single failure fails the whole snippet. Partial substitution would send
  // an unresolved placeholder into a real form field, which is both useless and
  // a way to leak the placeholder syntax to the page.
  if (failure) return { ok: false, error: failure };
  return { ok: true, code, usedAliases: [...usedAliases] };
}
