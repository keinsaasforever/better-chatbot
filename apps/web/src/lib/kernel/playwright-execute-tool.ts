import "server-only";
import { tool as createTool } from "ai";
import type { Kernel } from "@onkernel/sdk";
import { JSONSchema7 } from "json-schema";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import logger from "logger";
import {
  CREDENTIAL_PLACEHOLDER_PATTERN,
  resolveCredentialPlaceholders,
} from "./credential-placeholders";
import type { ResolvedCredential } from "./credential-vault";
import { createSecretRedactor } from "./redact-secrets";

/**
 * Playwright execution against a live Kernel browser, as an AI SDK tool.
 *
 * This is a local reimplementation of `playwrightExecuteTool` from
 * `@onkernel/ai-sdk`. That package is a thin wrapper around a single documented
 * call — `client.browsers.playwright.execute(sessionId, { code, timeout_sec })`
 * — and at 0.0.3 it declares a peer dependency on `ai@^5`, while this repo runs
 * `ai@6`. Rather than carry a version conflict for twenty lines, the wrapper
 * lives here, built against the AI SDK the rest of the app uses.
 *
 * The schema goes through `jsonSchemaToZod` like every other executable tool in
 * `lib/ai/tools`: it yields `z.ZodType<any>`, which is what the SDK's overloads
 * accept. A bare `z.object()` resolves to Zod 4's `ZodObject<…, $strip>` and
 * fails to match the `ZodType<…, ZodTypeDef, …>` those overloads expect.
 *
 * It is also the trust boundary for stored credentials: see
 * `./credential-placeholders`, which holds the substitution and the origin
 * binding that makes it safe.
 */
export const playwrightExecuteSchema: JSONSchema7 = {
  type: "object",
  properties: {
    code: {
      type: "string",
      description:
        "JavaScript/TypeScript Playwright code to run against the open page.",
    },
    timeout_sec: {
      type: "number",
      description: "Execution timeout in seconds. Defaults to 60.",
    },
  },
  required: ["code"],
};

export const createPlaywrightExecuteTool = ({
  client,
  sessionId,
  credentials = [],
  onCredentialUsed,
}: {
  client: Kernel;
  sessionId: string;
  /** Credentials this run may substitute. Empty on most runs. */
  credentials?: ResolvedCredential[];
  onCredentialUsed?: (aliases: string[]) => void;
}) => {
  // Built once per run rather than per call: the value set cannot change
  // mid-run, and the regex compilation is not free.
  const redact = createSecretRedactor(
    credentials.flatMap((credential) =>
      Object.entries(credential.fields)
        .filter(([, value]) => Boolean(value))
        .map(([field, value]) => ({
          value,
          token: `«redacted:${credential.alias}.${field}»`,
        })),
    ),
  );

  const execute = (code: string, timeoutSec?: number) =>
    client.browsers.playwright.execute(sessionId, {
      code,
      ...(timeoutSec ? { timeout_sec: timeoutSec } : {}),
    });

  return createTool({
    description: `Execute Playwright code against the live browser session.

The page is already open — write code against it directly. Prefer role- and
text-based locators over CSS selectors, and read the page before acting on it.
Return the values you extract so they can be reported back.`,
    inputSchema: jsonSchemaToZod(playwrightExecuteSchema),
    execute: async ({
      code,
      timeout_sec,
    }: {
      code: string;
      timeout_sec?: number;
    }) => {
      try {
        let finalCode = code;

        // Fast path: no placeholder, no extra round trip. Most steps are
        // navigation and reading, and only sign-in steps pay for the check.
        CREDENTIAL_PLACEHOLDER_PATTERN.lastIndex = 0;
        if (CREDENTIAL_PLACEHOLDER_PATTERN.test(code)) {
          if (credentials.length === 0) {
            return "This run has no stored credentials, so credential placeholders cannot be used. Call report_blocked if the page needs a sign-in.";
          }
          // Ask the browser where it is. Deliberately not the agent: the whole
          // point is that the origin is established independently of anything
          // the model (or a page that influenced it) claims.
          const urlResult = await execute("return page.url()");
          const pageUrl = extractUrl(urlResult);
          if (!pageUrl) {
            return "Could not determine the current page URL, so a credential cannot be used safely here. Navigate to the site first.";
          }

          const resolution = resolveCredentialPlaceholders({
            code,
            credentials,
            pageUrl,
          });
          if (!resolution.ok) {
            logger.warn(
              `[kernel] credential placeholder refused on ${sessionId}: ${resolution.error}`,
            );
            return resolution.error;
          }
          finalCode = resolution.code;
          if (resolution.usedAliases.length > 0) {
            onCredentialUsed?.(resolution.usedAliases);
          }
        }

        // Redact on the way out. This is the primary redaction point: it is the
        // only channel by which page text, console output or Playwright errors
        // reach the inner agent's context.
        return redact(await execute(finalCode, timeout_sec));
      } catch (error) {
        // Never log `code`: after substitution it contains the value.
        const message =
          error instanceof Error
            ? error.message
            : "Playwright execution failed";
        return redact(`Playwright execution failed: ${message}`);
      }
    },
  });
};

/**
 * Pull a URL out of whatever shape Kernel wraps a return value in.
 *
 * The SDK's response shape is not pinned across versions, so match on the
 * value rather than a field path: a URL is unmistakable, and guessing wrong
 * here fails closed (no substitution) rather than open.
 */
function extractUrl(result: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): string | null => {
    if (typeof value === "string") {
      return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
    }
    if (depth > 4 || value === null || typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    for (const entry of Object.values(value)) {
      const found = walk(entry, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(result, 0);
}
