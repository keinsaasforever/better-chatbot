# Observability

Navigator ships telemetry to [Superlog](https://superlog.sh) over OpenTelemetry:
traces, logs, and metrics. Superlog groups noisy signals into incidents and — once
the GitHub App is installed — opens merge-ready draft PRs for issues it judges
severe.

This sits **alongside** what was already here. consola still writes to stdout
(and therefore Vercel logs), PostHog still handles client-side product
analytics, and the `[boot]` diagnostics are untouched.

## Activation

Telemetry is wired up but **inert until a public ingest token is present**. With
no token, exporters are never constructed — no ingest attempts, no 401s, no
behavioural change.

To activate:

1. **Get a token.** Sign up at Superlog and copy the project's ingest token.
   Alternatively an agent can generate one and register a signup intent
   (`POST https://api.superlog.sh/api/signup-intents` with
   `{ keyHash: sha256(token), keyPrefix, returnTo: null }` — never the plaintext
   token), then finish auth at the returned `signupUrl`.
2. **Set it.** Both token formats are accepted, but they are not equally safe:
   - `sl_public_…` is project-scoped and write-only (same trust level as a
     PostHog project token or a Sentry DSN). This one may be inlined as
     `INLINE_PUBLIC_TOKEN` in `apps/web/src/lib/observability/superlog.ts`,
     which is Superlog's recommended path — a missing env var cannot then
     silently break ingest on deploy.
   - `superlog_live_…` is the older project format. Treat it as a **secret**:
     set `SUPERLOG_PUBLIC_TOKEN` only, never commit it, and never give it a
     `NEXT_PUBLIC_` prefix (that would ship it to every browser).

   Anything in neither format is treated as absent, so telemetry stays off
   rather than 401-ing on every export.
3. **Install the GitHub App** on `keinsaasforever/keinsaas-navigator` from the
   Superlog signup page. **Without this, autonomous PRs cannot happen** —
   Superlog can group incidents but has nowhere to push a fix.
4. **Connect Slack** on the same page for incident delivery.
5. **Add the MCP server** so a coding agent can query production telemetry
   directly: `claude mcp add --transport http superlog https://api.superlog.sh/mcp`.
   The MCP server does not take the ingest token: it wants OAuth or a personal
   access token (`superlog_pat_…`, Superlog → Settings → MCP tokens) as
   `Authorization: Bearer`. The cockpit's Superlog connection needs the same.

## Ingest contract

Getting any of these wrong produces silent failure, so they are worth stating:

| Thing | Value |
|---|---|
| Endpoint | `https://intake.superlog.sh` (`/v1/traces`, `/v1/logs`, `/v1/metrics`) |
| Auth header | `x-api-key: <token>` |
| Protocol | OTLP over **HTTP**, never gRPC |

Ingest reads the token from `x-api-key` or `Authorization: Bearer <token>` and
nothing else. `api-key`, `x-superlog-token`, or a bare `Authorization: <token>`
all return 401 with a perfectly valid token — the most common onboarding
failure by a wide margin.

## What is captured

### Traces

- **HTTP requests** — via `@vercel/otel` framework instrumentation.
- **AI Gateway calls** — `ai.streamText` / `ai.generateText` / `ai.toolCall`
  spans with `gen_ai.*` semantic-convention attributes: request and response
  model, provider, input/output token counts, finish reasons, and recorded
  exceptions. Every model call in this app goes through Vercel AI Gateway as a
  bare string model ID, so there is no per-provider SDK for OpenInference to
  instrument — the AI SDK's own telemetry is the only way inside a gateway call.
- **Chat stages** — `chat.stage.<name>` child spans from
  `lib/ai/request-timer.ts`, turning the pre-stream breakdown (MCP tool loading,
  RAG retrieval, billing lookups) into a flame graph.
- **Business operations** — `mcp.tool.call`, `mcp.tools.list`, `job.<function>`.
- **Cockpit feeds** — `cockpit.provider.probe|fetch|prepare` per provider
  (Stripe, Revolut, Superlog, SEO, Vercel, website), with `cockpit.outcome`
  and `cockpit.reason`. A failed probe logs `[cockpit] probe failed`; a feed
  logs `[cockpit] feed inop` / `feed live` only when its state changes, since an
  open cockpit refreshes every minute. Reasons are built by our own code
  (`lib/cockpit/reasons.ts`), so no provider response body or key reaches
  Superlog.

### Metrics

`chat.ttft`, `chat.total`, `chat.gateway.ttft`, `chat.stage.duration`,
`mcp.tool.calls`, `mcp.tool.call.duration`, `mcp.tools.list.lookups`,
`ai.route.decisions`, `billing.usage.events`, `job.runs`, `webhook.deliveries`,
`cockpit.provider.runs`.

Metric dimensions are deliberately low-cardinality — outcome, tool name,
function ID, error class. Org IDs, thread IDs and user IDs go on **spans**, never
on metric attributes.

### Logs

Every `logger.*` call in `apps/web` reaches Superlog through a consola reporter
(`lib/observability/consola-otel-reporter.ts`). Calls made inside a span carry
`trace_id` / `span_id` automatically, so the existing `LatencyTimer:` JSON lines
now cross-link into the trace they describe rather than floating free.

### User-reported problems

The sidebar "Report an issue" dialog turns a user's own report into an incident.
Superlog has no create-incident API — incidents are grouped from error-severity
signals — so `lib/problem-report/superlog-incident.ts` emits the report the same
way a crash is emitted: a `user.problem_report` span with ERROR status carrying a
recorded exception, plus an ERROR log record.

Two details are deliberate:

- The exception **type** is the constant `UserReportedProblem`, not the user's
  text, so every report groups under one issue instead of opening a fresh one
  per wording. The user's first line is the exception message.
- **No reporter identity** is attached — no user id, no email — matching the rule
  the rest of the telemetry follows. `problem_report.id` links the incident to
  the `problem_report` row in Postgres, which is where the reporter lives. The
  same submission also mails `tech@keinsaas.com`.

The description itself *is* attached, unlike chat content: a report with the text
stripped is not actionable, and the user wrote it in order to send it to us.

## What is *not* captured

**Prompt and completion text is off by default.** `recordInputs` and
`recordOutputs` are `false` unless `SUPERLOG_RECORD_AI_CONTENT=1`. Chat content
is user data and Superlog Cloud intake is US-hosted (see
`EU_NATIVE_MIGRATION.md`).

Turn it on only while chasing a specific bug, and prefer dev/staging:

```bash
SUPERLOG_RECORD_AI_CONTENT=1 pnpm dev
```

Everything needed for most debugging — model, provider, token counts, latency,
tool calls, error class and stack — flows either way.

No user IDs or emails are attached as span metadata anywhere. Organization and
thread IDs are opaque UUIDs and *are* attached, because without them an incident
is not actionable.

## Per-service setup

| Service | Bootstrap | Notes |
|---|---|---|
| `apps/web` | `src/instrumentation.ts` → `lib/observability/register.ts` | `registerOTel` runs **above** the `VERCEL === "1"` early return — everything below it is skipped in production |
| `apps/gateway` | `src/otel.ts`, imported first in `src/index.ts` | Standalone Node, so `NodeSDK` rather than `@vercel/otel`; flushes on `SIGTERM`/`SIGINT` |
| Inngest jobs | `lib/inngest/otel-middleware.ts` | Runs inside the Next process; middleware on the client instruments all functions, including future ones |
| `apps/desktop` | `src/main/otel.ts` | **Opt-in**, `KEINSAAS_DESKTOP_TELEMETRY=1`. Runs on user machines |
| `servers/mcp-stdio` | inline in `src/launch-filesystem.mjs` | Hand-rolled OTLP POST, not the SDK: this process's stdout *is* the MCP protocol stream, so anything that might write a diagnostic line would corrupt it. Awaiting the POST is also the flush |

### Runtime caveat

Logs and metrics are registered in the **Node runtime only**. The upstream OTLP
log/metric exporters resolve to a browser platform under Edge bundling, which
needs `XMLHttpRequest`/`sendBeacon` — neither exists in the Vercel Edge runtime.
Traces use `@vercel/otel`'s fetch-based exporter and work in both. Chat, MCP,
workflows and every AI Gateway call run in the Node runtime, so this costs
nothing in practice; `middleware.ts` is the main Edge surface.

## Verifying an install

Superlog's own gate: **all three signals must return 2xx.** Traces alone is a
failed install, not a partial success.

1. Start the app and send a real chat message.
2. Watch exporter responses for `/v1/traces`, `/v1/logs`, `/v1/metrics`.
   - **401/403** → the token is not claimed; finish signup, then re-run.
   - **Only `/v1/traces` arrives** → the log bridge is not wired. Check
     `logRecordProcessors` on `registerOTel`, and that the reporter is attached.
   - **`/v1/metrics` missing** → the metric reader is not wired.
3. Confirm the chat trace nests: request span → `chat.stage.*` → `ai.streamText`
   → `ai.streamText.doStream` with token counts.
4. **Confirm no content leaked.** Inspect an `ai.streamText` span for prompt or
   completion bodies. Then set `SUPERLOG_RECORD_AI_CONTENT=1`, re-run, confirm
   they *do* appear, and unset. Test the guardrail in both directions.

## Self-hosting

Superlog's community edition is Apache-2.0 (web + API + OTLP proxy + worker +
Postgres + ClickHouse). Moving to a self-hosted EU intake is a one-line change:
`SUPERLOG_ENDPOINT` in `lib/observability/superlog.ts`, mirrored in
`apps/gateway/src/otel.ts` and `apps/desktop/src/main/otel.ts`.
