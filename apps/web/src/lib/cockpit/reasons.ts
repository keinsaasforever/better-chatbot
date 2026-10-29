/**
 * INOP reasons travel as stable codes so the UI can translate them
 * (`Cockpit.reasons.<code>`), with an optional untranslated detail such as an
 * HTTP status or a missing MCP tool name: `"<code>"` or `"<code>|<detail>"`.
 *
 * Details are built by our own code only, never copied from a provider's
 * response body, so a reason can be shown and stored in `last_error` without
 * leaking anything a provider echoed back.
 */
export const REASON_CODES = [
  "notConnected",
  "disabled",
  "secretsUnavailable",
  "unauthorized",
  "wrongKey",
  "reauthorize",
  "rateLimited",
  "timeout",
  "http",
  "unreachable",
  "invalidResponse",
  "invalidConfig",
  "noDeployments",
  "noProjects",
  "toolMissing",
  "mcpServerMissing",
  "mcpAuthorize",
  "queryFailed",
  "spendSource",
  "marginSource",
  "serviceUnmatched",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export function reason(code: ReasonCode, detail?: string | number): string {
  return detail === undefined || detail === ""
    ? code
    : `${code}|${String(detail).slice(0, 120)}`;
}

export function parseReason(value: string): {
  code: ReasonCode | null;
  detail: string;
} {
  const [head, ...rest] = value.split("|");
  const code = (REASON_CODES as readonly string[]).includes(head)
    ? (head as ReasonCode)
    : null;
  return { code, detail: code ? rest.join("|") : value };
}

/** Maps an HTTP status from a provider API onto a reason. */
export function httpReason(status: number): string {
  if (status === 401 || status === 403) return reason("unauthorized");
  if (status === 429) return reason("rateLimited");
  return reason("http", status);
}

/** Maps a thrown fetch/MCP error onto a reason, without its message. */
export function errorReason(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError")
    return reason("timeout");
  if (error instanceof Error && error.name === "AbortError")
    return reason("timeout");
  if (error instanceof Error && error.message === "cockpit-deadline")
    return reason("timeout");
  return reason("unreachable");
}

type Translator = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

/** Human text for a reason in the current locale. */
export function reasonText(t: Translator, value: string): string {
  const { code, detail } = parseReason(value);
  if (!code) return value;
  const key = `reasons.${code}`;
  return t.has(key) ? t(key, { detail }) : value;
}
