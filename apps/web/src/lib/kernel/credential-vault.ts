import "server-only";
import { browserCredentialRepository } from "lib/db/repository";
import logger from "logger";
import {
  isSecretManagerConfigured,
  parseCredentialNote,
  readSecretLatestVersion,
} from "./secret-store";
import { redactionToken, type SecretToRedact } from "./redact-secrets";

/**
 * A credential resolved for one run: the row's public parts plus the actual
 * field values, read from the secret store.
 *
 * This shape never crosses into a model prompt. `buildCredentialCatalog` is
 * what the agent sees, and it carries names only.
 */
export type ResolvedCredential = {
  alias: string;
  domain: string;
  allowedUrlPrefix: string | null;
  /** e.g. `{ username, password, totp_secret }`. */
  fields: Record<string, string>;
  profileId: string | null;
  profileName: string | null;
};

/**
 * Load the credentials a run is allowed to use.
 *
 * Deliberately uncached. A per-request read of one or two secrets is cheap, and
 * a map of plaintext passwords living in a warm serverless instance between
 * unrelated requests is not a thing to build casually.
 *
 * Returns `[]` on any failure. A run without credentials degrades to "the agent
 * cannot sign in and reports blocked", which is the correct outcome; a run that
 * throws here would fail for a reason nobody can act on.
 */
export async function resolveBrowserCredentials(input: {
  organizationId?: string | null;
  aliases: string[];
}): Promise<ResolvedCredential[]> {
  if (!input.organizationId || input.aliases.length === 0) return [];
  if (!isSecretManagerConfigured()) {
    logger.warn(
      "[kernel] browser credentials requested but Secret Manager is not configured",
    );
    return [];
  }

  try {
    const refs = await browserCredentialRepository.selectSecretRefsByAliases(
      input.organizationId,
      input.aliases,
    );

    const resolved = await Promise.all(
      refs.map(async (ref): Promise<ResolvedCredential | null> => {
        // A row with a profile but no secret is valid and useful: the saved
        // session may be all the site needs. Only the field values are missing.
        if (!ref.externalSecretId) {
          return {
            alias: ref.alias,
            domain: ref.domain,
            allowedUrlPrefix: ref.allowedUrlPrefix,
            fields: {},
            profileId: ref.kernelProfileId,
            profileName: ref.kernelProfileName,
          };
        }
        try {
          const note = await readSecretLatestVersion(ref.externalSecretId);
          return {
            alias: ref.alias,
            domain: ref.domain,
            allowedUrlPrefix: ref.allowedUrlPrefix,
            fields: parseCredentialNote(note),
            profileId: ref.kernelProfileId,
            profileName: ref.kernelProfileName,
          };
        } catch (error) {
          // Never include the secret name or id in the log line.
          logger.error(
            `[kernel] could not read credential "${ref.alias}"`,
            error instanceof Error ? error.message : error,
          );
          return null;
        }
      }),
    );

    return resolved.filter((entry): entry is ResolvedCredential => !!entry);
  } catch (error) {
    logger.error(
      "[kernel] could not resolve browser credentials",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * The ONLY credential-related text the inner agent ever sees.
 *
 * Names and domains, never values. The agent writes a placeholder and the
 * server substitutes after the code has left the model, so a compromised or
 * confused agent has nothing to leak — it never held the secret.
 */
export function buildCredentialCatalog(
  credentials: ResolvedCredential[],
): string {
  const usable = credentials.filter(
    (credential) => Object.keys(credential.fields).length > 0,
  );
  const savedSessions = credentials.filter(
    (credential) => credential.profileName,
  );

  const lines: string[] = [];

  if (savedSessions.length > 0) {
    lines.push(
      "Saved sign-ins loaded into this browser: " +
        savedSessions.map((c) => `${c.alias} (${c.domain})`).join(", ") +
        ". You may already be signed in to these. Check before trying to sign in again.",
    );
  }

  if (usable.length === 0) {
    if (lines.length === 0) return "";
    return lines.join("\n\n");
  }

  lines.push(
    [
      "Credentials available on this run. The VALUES are hidden from you and",
      "you cannot read them. Reference them by placeholder only:",
      "",
      ...usable.map(
        (credential) =>
          `- ${credential.alias} (${credential.domain}) — fields: ${Object.keys(
            credential.fields,
          ).join(", ")}`,
      ),
      "",
      "Write the placeholder literally in your Playwright code; the server",
      "substitutes the real value after you send it, and only on the domain",
      "listed above:",
      "",
      "    await page.getByLabel('Password').fill('{{cred:<alias>.password}}')",
      "",
      "Never print, log, return or re-type a credential value, and never put",
      "one in your summary. If a placeholder is refused, this is not a site you",
      `are allowed to sign in to — call \`report_blocked\` rather than trying`,
      "another way in.",
    ].join("\n"),
  );

  return lines.join("\n\n");
}

/** Every value that must not survive into a model context or a log. */
export function collectSecretValues(
  credentials: ResolvedCredential[],
): SecretToRedact[] {
  const secrets: SecretToRedact[] = [];
  for (const credential of credentials) {
    for (const [field, value] of Object.entries(credential.fields)) {
      if (!value) continue;
      secrets.push({ value, token: redactionToken(credential.alias, field) });
    }
  }
  return secrets;
}

/**
 * The profile to load into this run's browser, if any.
 *
 * With one granted credential it is that one. With several, the agent's
 * optional `credentialAlias` input picks — validated against the granted set,
 * so it can only narrow, never widen. With several and no pick, none: loading
 * an arbitrary one would be a guess, and a wrong saved session is worse than a
 * clean browser.
 */
export function selectProfile(
  credentials: ResolvedCredential[],
  requestedAlias?: string,
): { name: string; alias: string } | null {
  const withProfile = credentials.filter((c) => c.profileName);
  if (withProfile.length === 0) return null;

  if (requestedAlias) {
    const match = withProfile.find((c) => c.alias === requestedAlias);
    return match?.profileName
      ? { name: match.profileName, alias: match.alias }
      : null;
  }

  if (withProfile.length === 1 && withProfile[0].profileName) {
    return { name: withProfile[0].profileName, alias: withProfile[0].alias };
  }
  return null;
}
