<div align="center">

# better-chatbot

**An open-source AI chat and agent platform you can host yourself.**

Talk to any model, attach your files, connect MCP tool servers, build workflows,
and give agents a place to work — on infrastructure you control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/9dwdAYKBPp)

</div>

---

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkeinsaasforever%2Fbetter-chatbot&project-name=better-chatbot&repository-name=better-chatbot&root-directory=apps%2Fweb&env=BETTER_AUTH_SECRET&envDescription=Session%20signing%20key%3A%20any%20long%20random%20string%2C%20e.g.%20the%20output%20of%20%60openssl%20rand%20-base64%2032%60.&envLink=https%3A%2F%2Fgithub.com%2Fkeinsaasforever%2Fbetter-chatbot%2Fblob%2Fmain%2Fdocs%2Fself-hosting.md%23vercel&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D)

One click, one value. The button clones the repository, provisions a Neon
Postgres database, and asks for a single secret — any long random string
(`openssl rand -base64 32`). The schema is created during the build, and models
run through the Vercel AI Gateway on your Vercel account with no API key. Open
the deployment and create an account; the first one becomes the administrator.

Details and optional features: [docs/self-hosting.md](docs/self-hosting.md#vercel).

---

## Quick start (Docker)

Three variables. That is the whole configuration to get chatting:

```bash
git clone https://github.com/keinsaasforever/better-chatbot.git
cd better-chatbot
cp .env.example .env
```

```bash
POSTGRES_URL=postgres://postgres:postgres@postgres:5432/better_chatbot
BETTER_AUTH_SECRET=   # npx @better-auth/cli@latest secret
AI_GATEWAY_API_KEY=   # https://vercel.com/ai-gateway
```

```bash
docker compose -f docker/compose.yml up -d --build
```

Open http://localhost:3000 and create an account. The first account becomes the
administrator.

**Why one model key?** Models are served through the Vercel AI Gateway, which
fronts Anthropic, OpenAI, Google, Mistral, xAI, DeepSeek, Moonshot and more. You
manage one key and one bill instead of seven, and you can switch models
mid-conversation without touching configuration. If you would rather not use a
gateway at all, point the app at Ollama, LM Studio, or any OpenAI-compatible
endpoint — see [Models](#models).

Prefer running it directly? See [docs/self-hosting.md](docs/self-hosting.md).

---

## What you get

**Chat that does things.** Streaming conversations with tool calling, file
attachments, image generation, and a sandboxed code runner. Mention an agent,
workflow, or tool with `@` to pull it into the conversation.

**Agents.** Give an agent a role, instructions, and a set of tools. Share it
with your workspace or keep it private.

**Skills.** Reusable capabilities an agent loads on demand, so a large toolbox
does not have to sit in every prompt.

**Projects with retrieval.** Group chats, documents, and tools around a piece of
work. Uploaded documents are chunked, embedded, and searched with pgvector —
no external service required. Point a project at a knowledge base if you want
hosted retrieval instead.

**Workflows.** Build a graph of steps — LLM calls, conditions, HTTP requests,
code, templates — in a visual editor, publish it as a tool, and call it from any
chat.

**MCP tool servers.** Connect any Model Context Protocol server over HTTP or
stdio, with OAuth support, per-tool customization and a cached tool list.
Self-hosted instances can run stdio servers; the desktop app runs them locally.

**Scheduled tasks.** Have an agent run on a schedule and report back.

**Voice.** Realtime voice conversations through the gateway, plus transcription.

**Desktop app.** An Electron build that adds local MCP servers, filesystem
access, and the system keychain.

**Model routing.** Pick a model per message, or let the router choose from the
catalog based on the task.

---

## Upgrading from 1.x

This is a new major version. The layout is now a monorepo, the environment is
different, and the schema has moved on considerably.

**Back up your database first.** Then:

```bash
pnpm install
pnpm tsx scripts/upgrade/from-better-chatbot-1.ts --dry-run
pnpm tsx scripts/upgrade/from-better-chatbot-1.ts --yes
```

The upgrade preserves your users, chats, agents, MCP servers and workflows.
Archives become projects, and the threads inside them stay linked. It is a
one-way migration — this is why the backup matters.

If you were setting per-provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
and friends), replace them with a single `AI_GATEWAY_API_KEY`, or configure a
local provider.

---

## Setup

### Vercel

The [Deploy button](#deploy-to-vercel) above. Setting up an existing clone by
hand is described in [docs/self-hosting.md](docs/self-hosting.md#vercel).

### Docker Compose

The [quick start](#quick-start-docker) above. The bundled stack includes Postgres with
pgvector. Add `--profile redis` if you want resumable chat streams.

### Local development

```bash
pnpm install            # writes .env from .env.example
pnpm docker:pg          # Postgres with pgvector on :5432
pnpm db:migrate         # apply the schema
pnpm dev                # http://localhost:3000
```

Postgres **must** have the `pgvector` extension — document embeddings are stored
as `vector(1536)`. The bundled image has it; managed Postgres usually offers it
as a toggle.

Useful commands:

| Command | What it does |
| --- | --- |
| `pnpm check` | Lint, typecheck and unit tests — run before committing |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Browse the database |
| `pnpm docker:redis` | Redis for resumable streams |

---

## Optional integrations

Everything below is off until you configure it. The server prints which
features are disabled at startup, so you always know why something is missing.

| Feature | Set | Without it |
| --- | --- | --- |
| File uploads | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` | Attachments, avatars and generated images are disabled |
| Knowledge bases | `AGENTSET_API_KEY` | Knowledge bases unavailable; project documents still search locally with pgvector |
| Background jobs | `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Scheduled tasks and the project brain need your own cron — see below |
| Resumable streams | `REDIS_URL` | A stream ends when the viewer navigates away |
| Code sandbox | `E2B_API_KEY` | Generated code runs in the in-browser worker only |
| Web search | `EXA_API_KEY` | The web search tool is unavailable |
| Voice transcription | `ASSEMBLYAI_API_KEY` | Realtime voice still works; transcription does not |
| Browser notifications | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | No notifications while the app is closed |
| Connected apps | `COMPOSIO_API_KEY` | Users cannot connect Gmail, Slack, GitHub and other apps |
| Observability | `SUPERLOG_PUBLIC_TOKEN` | Traces and logs stay local |

**Running without Inngest.** Scheduled tasks and the sandbox reaper are plain
HTTP endpoints. Set `SCHEDULED_TASK_SECRET` and call them from any cron:

```bash
curl -X POST https://your-instance/api/scheduled-tasks/cron \
  -H "X-Scheduled-Task-Auth: $SCHEDULED_TASK_SECRET"
```

---

## Models

The gateway is the default and covers the whole catalog. You can also:

- **Run models locally.** Connect Ollama, LM Studio, or any OpenAI-compatible
  endpoint from the model picker. Nothing leaves your machine, and it needs no
  server configuration — each account sets up its own.
- **Use [TensorX](#partners).** EU-hosted inference with zero data retention,
  reached directly rather than through the gateway. Set `TENSORX_API_KEY`.
- **Add any OpenAI-compatible provider** with `OPENAI_COMPATIBLE_DATA`:
  `pnpm openai-compatiable:init && pnpm openai-compatiable:parse`.

---

## Partners

**[TensorX](https://tensorx.ai/)** — EU-hosted model inference with zero data
retention. better-chatbot talks to TensorX directly rather than through a
gateway, so prompts go straight to TensorX's EU infrastructure. Create a key at
[tensorx.ai](https://tensorx.ai/), set `TENSORX_API_KEY`, and its models appear
in the model picker next to the gateway's. See its
[trust and security](https://tensorx.ai/trust-security/) page and
[DPA](https://tensorx.ai/dpa/).

TensorX is optional. Without the key everything else works as before.

---

## Community

- **[Discord](https://discord.gg/9dwdAYKBPp)** — questions, help, and what
  people are building
- **[Issues](https://github.com/keinsaasforever/better-chatbot/issues)** — bugs
  and feature requests
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to work in this repository

---

## This edition, and the hosted one

better-chatbot is the community edition of
[keinsaas Navigator](https://keinsaas.com). Everything above is here, in full,
with no usage caps and no telemetry.

What Navigator adds is what teams need and single users do not: shared team
workspaces with member management and invitations, per-member AI budgets and
org-wide model policy, billing, a managed workflow builder, and a Slack bot.
If you are running this for yourself or a small group, you are not missing
anything — that is the point.

---

## License

MIT. See [LICENSE](LICENSE).

Originally forked from [cgoinglove/better-chatbot](https://github.com/cgoinglove/better-chatbot),
whose work this is built on.
