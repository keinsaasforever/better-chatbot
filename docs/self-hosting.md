# Self-hosting

Everything you need to run better-chatbot yourself, in the order you will need
it. The [README](../README.md) has the three-variable quick start; this is the
reference behind it.

## Requirements

- **Postgres 15+ with `pgvector`.** Document embeddings are stored as
  `vector(1536)`, so the extension is not optional. The bundled compose file
  uses `pgvector/pgvector:pg17`; Supabase, Neon and RDS all offer it.
- **Node 20+ and pnpm 10** if you are running without Docker.
- **A model provider.** The Vercel AI Gateway is the default; Ollama, LM Studio,
  TensorX or any OpenAI-compatible endpoint work too.

## Required configuration

| Variable | Purpose |
| --- | --- |
| `POSTGRES_URL` | Postgres connection string, pgvector enabled (`DATABASE_URL` is accepted too) |
| `BETTER_AUTH_SECRET` | Session signing key — `npx @better-auth/cli@latest secret` |
| `AI_GATEWAY_API_KEY` | Serves every model in the catalog — not needed on Vercel |

The server refuses to start without these and tells you which one is missing. If
you configure a different provider (`TENSORX_API_KEY`, `GROQ_API_KEY`,
`OLLAMA_BASE_URL`, `OPENAI_COMPATIBLE_DATA`), that satisfies the model
requirement in place of the gateway key.

Once you are not on localhost, also set `BETTER_AUTH_URL` and
`NEXT_PUBLIC_BASE_URL` to the public URL of your instance, or sign-in redirects
and OAuth callbacks will point at the wrong host.

## Vercel

The [Deploy button](../README.md#deploy-to-vercel) does all of this for you. To
set up a project by hand:

1. Import the repository and set **Root Directory** to `apps/web`. The
   `vercel.json` there holds the monorepo install and build commands.
2. Add a Postgres database from the Vercel Marketplace (Neon works; it ships
   `pgvector`). The integration sets `DATABASE_URL`, which the app reads when
   `POSTGRES_URL` is absent. Any other Postgres with pgvector works too — set
   `POSTGRES_URL` yourself, using the pooled connection string.
3. Set `BETTER_AUTH_SECRET` to a long random string.
4. Deploy.

What happens without further configuration:

- **Migrations run during the build**, before the app is compiled. A build
  fails rather than shipping an app whose schema does not match the code.
  Preview deployments migrate whichever database their `POSTGRES_URL` points
  at — give the Preview environment its own database if you use previews to
  try out upgrades.
- **Models need no key.** On Vercel the AI Gateway authenticates with the
  deployment's OIDC token and bills your Vercel team. Set `AI_GATEWAY_API_KEY`
  only if you want to bill a different account.
- **It fits the free Hobby plan.** Functions run for at most 300 seconds there,
  and the chat route is set to that limit; a turn wraps up a minute before it
  so the answer is always saved. On Pro, very long reasoning turns benefit from
  raising `maxDuration` in `apps/web/src/app/api/chat/route.ts` to 600.
- **URLs are inferred.** Sign-in works on the `*.vercel.app` URL and on custom
  domains without configuration. Set `BETTER_AUTH_URL` and
  `NEXT_PUBLIC_BASE_URL` to your custom domain once you add OAuth providers,
  so callbacks and links point at it.

Everything in the sections below is optional. The Vercel Marketplace has
integrations for Upstash (`KV_URL` — resumable streams) and Inngest
(background jobs), which set their own variables.

## Storage

File uploads go to Supabase Storage. Without it the app runs fine — attachments,
avatars and generated images are simply unavailable.

1. Create a Supabase project (the free tier is enough; you are using it for
   object storage, not as your database unless you want to).
2. Create three buckets: `attachments` (private), `avatars` (public) and
   `ai-generated` (public).
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL`.

`NEXT_PUBLIC_SUPABASE_URL` must match `SUPABASE_URL`. The browser uses it to
build file URLs and to run resumable (TUS) uploads, which is how large files
avoid request-size limits. Uploads fail with a clear message if it is unset.

## Retrieval

Project documents are chunked, embedded through your model provider, and
searched with pgvector. This needs no extra service.

`AGENTSET_API_KEY` adds knowledge bases — hosted ingestion and retrieval with
reranking and citations. Without it, knowledge bases are unavailable and
projects fall back to local search.

## Background jobs

Scheduled tasks, project-brain ingestion and the sandbox reaper run on Inngest.
For local development `npx inngest-cli dev` needs no keys; for production set
`INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY`.

You can run without Inngest. Two of the jobs are plain HTTP endpoints — set
`SCHEDULED_TASK_SECRET` and drive them from cron:

```bash
curl -X POST https://your-instance/api/scheduled-tasks/cron \
  -H "X-Scheduled-Task-Auth: $SCHEDULED_TASK_SECRET"

curl -X POST https://your-instance/api/sandbox/reaper \
  -H "X-Scheduled-Task-Auth: $SCHEDULED_TASK_SECRET"
```

Project-brain ingestion has no HTTP fallback and stays idle without Inngest.

## Connected apps (Composio)

Users connect Gmail, Slack, GitHub, Notion and a few hundred other apps through
[Composio](https://composio.dev), which hosts the OAuth apps for most of them,
so you usually register none yourself. Create a free account at platform.composio.dev, copy its API
key into `COMPOSIO_API_KEY`, and the app catalog fills in. Each user's
connections are their own, keyed by their account on your instance.

Without the key, the app list stays empty and chats never call Composio.
Composio's free tier has a monthly tool-call allowance; check its pricing page
before opening an instance to many users.

## Cockpit

`/cockpit` is a dashboard of the systems behind your business. Every user (or
workspace) connects their own sources under **CONNECT**: Stripe, Vercel,
Revolut, Superlog and an SEO provider. Each takes that service's own API key
or token, entered in the app, never in env vars.

Nothing needs configuring on the server. Those credentials are encrypted at
rest with a key derived from `BETTER_AUTH_SECRET`, so rotating that secret
means users re-enter their connections. To decouple the two, set a dedicated
`APP_SECRETS_KEY` (`openssl rand -base64 32`) before anyone connects anything;
changing it later has the same effect.

The `website` source expects a `site_events` table in a Supabase project, the
format keinsaas's own marketing site writes. It is not a general analytics
integration yet.

## Redis

Optional, and used for one thing: resumable chat streams. With `REDIS_URL` set,
a response keeps generating when the viewer closes the tab and can be picked up
again, and a stop from one browser reaches an instance serving another. Without
it, a stream is bound to the viewer that started it and the cache is
per-instance — fine for a single-instance deployment.

## Sign-in

Email and password works out of the box; the first account created becomes the
administrator. OAuth is available for GitHub, Google and Microsoft — set the
corresponding `*_CLIENT_ID` and `*_CLIENT_SECRET` pairs.

`DISABLE_SIGN_UP=1` closes registration after you have made your accounts, which
is what you want on an instance exposed to the internet.

**Password resets:** Better Auth generates the reset link, but this edition
ships no email provider, so nothing delivers it. Reset passwords from the admin
area, or implement `sendPasswordResetEmail` in `apps/web/src/lib/gate/impl.ts`
to hook up your own mail service.

## Running behind a proxy

Terminate TLS at your proxy and forward to port 3000. Set `BETTER_AUTH_URL` and
`NEXT_PUBLIC_BASE_URL` to the public HTTPS URL so cookies get the right domain
and secure flag. For local HTTP without certificates, `NO_HTTPS=1`.

## Database maintenance

Migrations run automatically at boot. To apply them yourself:

```bash
pnpm db:migrate
```

On a database you created with `pnpm db:push` rather than migrations, start with
`SKIP_DB_MIGRATE=1` so boot does not try to replay history the database never
had.

`POSTGRES_POOL_MAX` is the pool size **per instance**. Keep
`instances × POSTGRES_POOL_MAX` under your database's connection limit —
a pooled Postgres is easy to exhaust under concurrent chat load.

Back up with `pg_dump` before upgrading. Nothing here is exotic; it is a single
Postgres database plus whatever you put in object storage.

## Upgrading from 1.x

See [Upgrading](../README.md#upgrading-from-1x). Back up first — the migration
is one-way.

One migration in the sequence rewrites `chat_message` in place, converting its
`metadata` column to `jsonb`. On a small database this is instant; on one with
a long chat history it takes an `ACCESS EXCLUSIVE` lock for the duration of the
rewrite, so the app is unavailable while it runs. Check the size first and
schedule accordingly:

```sql
SELECT count(*), pg_size_pretty(pg_total_relation_size('chat_message'))
FROM chat_message;
```

## Telemetry

There is none. No analytics, no phone-home, no usage reporting. If you want
observability for your own instance, set `SUPERLOG_PUBLIC_TOKEN` and traces go
to the endpoint you configure — and nowhere else.
