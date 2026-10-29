/**
 * Superlog / OpenTelemetry configuration — single source of truth.
 *
 * Superlog ingests OTLP traces, logs, and metrics, groups noisy signals into
 * incidents, and (once the GitHub App is installed on the repo) opens draft PRs
 * for issues it judges severe. Everything the exporters need lives here so that
 * swapping Superlog Cloud for a self-hosted EU intake is a one-line change.
 *
 * ## Token model
 *
 * Superlog issues two token formats and they are *not* equally safe:
 *
 * - `sl_public_…` — project-scoped and write-only. It cannot read data or
 *   change settings, so it is safe in source, at the same trust level as a
 *   PostHog project token or a Sentry DSN. Superlog's own guidance is to inline
 *   it rather than route it through an env var, so a missing env var cannot
 *   silently break ingest on deploy.
 * - `superlog_live_…` — the older project format. Treat it as a **secret**:
 *   env var only, never committed, and never behind a `NEXT_PUBLIC_` prefix
 *   (which would ship it to every browser).
 *
 * Both are accepted so a project that was issued the older format works without
 * waiting on a reissue. `SUPERLOG_PUBLIC_TOKEN` is the override either way, so
 * the token can also be rotated without a redeploy.
 *
 * Until a real token is set, {@link isSuperlogConfigured} is false and the
 * bootstrap skips exporter registration entirely — no ingest attempts, no 401
 * spam, no behavioural change to the app.
 */

/** OTLP intake host. Swap for a self-hosted EU intake when we migrate. */
export const SUPERLOG_ENDPOINT = "https://intake.superlog.sh";

/**
 * Inline ingest token. Only ever put a *write-only* `sl_public_…` token here —
 * a `superlog_live_…` token is a secret and belongs in `SUPERLOG_PUBLIC_TOKEN`.
 */
const INLINE_PUBLIC_TOKEN = "";

export const SUPERLOG_PUBLIC_TOKEN =
  process.env.SUPERLOG_PUBLIC_TOKEN?.trim() || INLINE_PUBLIC_TOKEN;

/** Token formats Superlog's ingest accepts. See the token model above. */
export const ACCEPTED_TOKEN_PREFIXES = [
  "sl_public_",
  "superlog_live_",
] as const;

/**
 * Telemetry is only wired up once a real ingest token is present. A value
 * carrying neither known prefix is a misconfiguration (an account or admin
 * token pasted by mistake, or a half-copied string) and is treated as absent
 * rather than sent — otherwise every request 401s against the intake.
 */
export const isSuperlogConfigured = (): boolean =>
  ACCEPTED_TOKEN_PREFIXES.some((prefix) =>
    SUPERLOG_PUBLIC_TOKEN.startsWith(prefix),
  );

/**
 * Ingest reads the token from exactly two places: `x-api-key`, or
 * `Authorization: Bearer <token>` with the literal `Bearer ` prefix. Any other
 * header name returns 401 on every request — the single most common onboarding
 * failure. `x-api-key` also survives proxies that strip `Authorization`.
 */
export const superlogHeaders = (
  token: string = SUPERLOG_PUBLIC_TOKEN,
): Record<string, string> => ({ "x-api-key": token });

export const superlogSignalUrl = (
  signal: "traces" | "logs" | "metrics",
): string => `${SUPERLOG_ENDPOINT}/v1/${signal}`;

/**
 * Whether prompt and completion text is recorded on AI SDK spans.
 *
 * Off by default: chat content is user data and the intake is US-hosted (see
 * `docs/EU_NATIVE_MIGRATION.md`). Enable per-environment only while chasing a
 * specific bug, and prefer dev/staging over production.
 */
export const RECORD_AI_CONTENT = process.env.SUPERLOG_RECORD_AI_CONTENT === "1";

/**
 * Deployment environment name.
 *
 * Vercel reports `production` for every branch deploy that is not a preview, so
 * the branch is folded in to keep the `staging` and `dev` branch deploys
 * (staging.keinsaas.com / dev.keinsaas.com) distinguishable in Superlog.
 */
const resolveEnvironmentName = (): string => {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (branch === "staging" || branch === "dev") return branch;
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
};

/**
 * Canonical https URL of this repository.
 *
 * Superlog maps a span back to source through `vcs.repository.url.full`; without
 * it the agent cannot open a PR. Read from the build platform when available so
 * forks and renames follow automatically.
 */
const resolveRepositoryUrl = (): string => {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  if (owner && slug) return `https://github.com/${owner}/${slug}`;
  return "https://github.com/keinsaasforever/keinsaas-navigator";
};

/** Commit SHA, best-effort from whatever the runtime already injects. */
const resolveCommitSha = (): string | undefined =>
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.SOURCE_COMMIT ??
  process.env.GIT_COMMIT;

/**
 * Resource attributes attached to every signal from every service.
 *
 * Uses OpenTelemetry semantic-convention keys verbatim — Superlog matches on
 * `vcs.repository.url.full` and `vcs.ref.head.revision` exactly, so renaming
 * them to something friendlier breaks the source mapping.
 */
export const resolveResourceAttributes = (
  serviceName: string,
): Record<string, string> => {
  const sha = resolveCommitSha();
  return {
    "service.name": serviceName,
    "service.version": process.env.npm_package_version ?? "0.0.0",
    "deployment.environment.name": resolveEnvironmentName(),
    "vcs.repository.url.full": resolveRepositoryUrl(),
    ...(sha ? { "vcs.ref.head.revision": sha } : {}),
  };
};
