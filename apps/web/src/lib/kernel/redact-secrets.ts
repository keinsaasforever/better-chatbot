/**
 * Strip resolved credential values out of anything on its way back to a model,
 * a persisted message, or a log line.
 *
 * This is DEPTH, not the control. The control is the origin binding in
 * `playwright-execute-tool`: a placeholder only resolves on the one origin a
 * human registered, so a value never reaches a page that was not supposed to
 * have it. Redaction covers the remaining case, where the site the credential
 * legitimately belongs to echoes it back — a value attribute, a validation
 * error, a URL query string — and that text would otherwise land in the inner
 * agent's context and from there in `chat_message.parts`.
 *
 * Be honest about the limit: this is exact-string matching over a handful of
 * encodings. A site that returns the value hashed, chunked across DOM nodes, or
 * transformed defeats it. Do not treat a redactor as permission to let secrets
 * flow somewhere they otherwise should not.
 *
 * No `server-only`: it is pure, and its test should not need a server context.
 */

export type SecretToRedact = {
  /** The raw value. Never logged, never stored. */
  value: string;
  /** What to put in its place, e.g. `«redacted:emta.password»`. */
  token: string;
};

/**
 * Values shorter than this are skipped. A 3-character password is a bad
 * password, but redacting it would blank out unrelated text everywhere it
 * happens to appear, which corrupts the agent's view of the page for no real
 * protection.
 */
const MIN_REDACTABLE_LENGTH = 4;

/**
 * Depth cap for the object walk. Kernel's execute result is shallow JSON;
 * anything deeper is either cyclic or not worth the traversal.
 */
const MAX_DEPTH = 8;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The encodings one value can arrive in.
 *
 * A password that reaches the page as a form field can come back URL-encoded
 * in a query string, backslash-escaped inside a JSON blob the page rendered,
 * or base64'd in a token. Cheap to cover, and missing one of them is exactly
 * the kind of near-miss that makes a redactor worse than useless.
 */
function encodingsOf(value: string): string[] {
  const forms = new Set<string>([value]);
  try {
    forms.add(encodeURIComponent(value));
  } catch {
    // Lone surrogate. The raw form is still covered.
  }
  // JSON.stringify wraps in quotes; the escaped body is what appears inline.
  forms.add(JSON.stringify(value).slice(1, -1));
  try {
    forms.add(Buffer.from(value, "utf8").toString("base64"));
  } catch {
    // Not encodable. Ignore.
  }
  return [...forms].filter((form) => form.length >= MIN_REDACTABLE_LENGTH);
}

type Replacement = { pattern: RegExp; token: string };

function buildReplacements(secrets: SecretToRedact[]): Replacement[] {
  const replacements: Replacement[] = [];
  for (const secret of secrets) {
    if (!secret.value || secret.value.length < MIN_REDACTABLE_LENGTH) continue;
    for (const form of encodingsOf(secret.value)) {
      replacements.push({
        pattern: new RegExp(escapeRegExp(form), "g"),
        token: secret.token,
      });
    }
  }
  // Longest first: a password that contains the username (or one secret that
  // is a prefix of another) would otherwise leave a readable fragment behind.
  return replacements.sort(
    (a, b) => b.pattern.source.length - a.pattern.source.length,
  );
}

/**
 * Build a redactor over a set of secrets.
 *
 * Returns identity when there is nothing to redact, so the common no-credential
 * path costs one comparison rather than a full structural walk.
 */
export function createSecretRedactor(
  secrets: SecretToRedact[],
): <T>(input: T) => T {
  const replacements = buildReplacements(secrets);
  if (replacements.length === 0) return (input) => input;

  const redactString = (input: string): string => {
    let output = input;
    for (const { pattern, token } of replacements) {
      // Reset: the regexes are /g and reused across calls, so a stale
      // lastIndex would silently skip matches in a later string.
      pattern.lastIndex = 0;
      output = output.replace(pattern, token);
    }
    return output;
  };

  const walk = (input: unknown, depth: number): unknown => {
    if (typeof input === "string") return redactString(input);
    if (depth >= MAX_DEPTH || input === null || typeof input !== "object") {
      return input;
    }
    if (Array.isArray(input)) return input.map((item) => walk(item, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = walk(value, depth + 1);
    }
    return output;
  };

  return <T>(input: T): T => walk(input, 0) as T;
}

/** The placeholder a redacted value is replaced with. */
export function redactionToken(alias: string, field: string): string {
  return `«redacted:${alias}.${field}»`;
}
