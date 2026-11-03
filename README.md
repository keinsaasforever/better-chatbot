<div align="center">

<img src="docs/assets/navigator-banner.webp" alt="keinsaas Navigator: your operating system for the AI era. Powered by agents, skills, MCP and workflows." width="100%" />

# keinsaas Navigator – Community Edition

<sub>formerly <b>better-chatbot</b></sub>

**An open-source AI chat and agent platform you can host yourself.**

Talk to any model, attach your files, connect MCP tool servers, build workflows,
and give agents a place to work — on infrastructure you control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/9dwdAYKBPp)

</div>

---

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkeinsaasforever%2Fbetter-chatbot&project-name=better-chatbot&repository-name=better-chatbot&root-directory=apps%2Fweb&env=BETTER_AUTH_SECRET%2CAI_GATEWAY_API_KEY%2CCOMPOSIO_API_KEY%2CTENSORX_API_KEY%2CASSEMBLYAI_API_KEY%2CEXA_API_KEY%2CE2B_API_KEY%2CINNGEST_EVENT_KEY%2CINNGEST_SIGNING_KEY&envDefaults=%7B%22AI_GATEWAY_API_KEY%22%3A%22required%22%2C%22COMPOSIO_API_KEY%22%3A%22optional%22%2C%22TENSORX_API_KEY%22%3A%22optional%22%2C%22ASSEMBLYAI_API_KEY%22%3A%22optional%22%2C%22EXA_API_KEY%22%3A%22optional%22%2C%22E2B_API_KEY%22%3A%22optional%22%2C%22INNGEST_EVENT_KEY%22%3A%22optional%22%2C%22INNGEST_SIGNING_KEY%22%3A%22optional%22%7D&envDescription=Required%3A%20BETTER_AUTH_SECRET%20%28any%20long%20random%20string%2C%20e.g.%20openssl%20rand%20-base64%2032%29%20and%20AI_GATEWAY_API_KEY%20%28vercel.com%2Fai-gateway%3B%20serves%20every%20model%2C%20including%20realtime%20voice%29.%20Optional%2C%20leave%20at%20optional%20to%20switch%20the%20feature%20off%3A%20COMPOSIO_API_KEY%20%28connected%20apps%29%2C%20TENSORX_API_KEY%20%28EU-hosted%20models%29%2C%20ASSEMBLYAI_API_KEY%20%28voice%20transcription%29%2C%20EXA_API_KEY%20%28web%20search%29%2C%20E2B_API_KEY%20%28code%20sandboxes%29%2C%20INNGEST_EVENT_KEY%20and%20INNGEST_SIGNING_KEY%20%28scheduled%20agents%29.%20Add%20any%20of%20them%20later%20under%20Settings%2C%20Environment%20Variables.&envLink=https%3A%2F%2Fgithub.com%2Fkeinsaasforever%2Fbetter-chatbot%2Fblob%2Fmain%2Fdocs%2Fself-hosting.md%23vercel&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22supabase%22%2C%22productSlug%22%3A%22supabase%22%2C%22protocol%22%3A%22storage%22%7D%5D)

Two required values, a few optional ones. The button clones the repository,
creates a free Supabase project for the database and file uploads, and asks
for:

| Variable | |
| --- | --- |
| `BETTER_AUTH_SECRET` | **Required.** Any long random string (`openssl rand -base64 32`). |
| `AI_GATEWAY_API_KEY` | **Required.** From [vercel.com/ai-gateway](https://vercel.com/ai-gateway). Serves every model in the catalog, including realtime voice. |
| `COMPOSIO_API_KEY` | Optional. Lets users connect Gmail, Slack, GitHub and more. [Free key](https://platform.composio.dev) |
| `TENSORX_API_KEY` | Optional. EU-hosted models from our [partner](#partners) TensorX. |
| `ASSEMBLYAI_API_KEY` | Optional. Voice transcription via [AssemblyAI](https://www.assemblyai.com/). |
| `EXA_API_KEY` | Optional. Web search via [Exa](https://exa.ai/). |
| `E2B_API_KEY` | Optional. Sandboxes that run generated code, via [E2B](https://e2b.dev/). Without it, code runs in the browser. |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Optional. Scheduled agents and background jobs, via [Inngest](https://www.inngest.com/). Easiest: add the Inngest integration in Vercel, which sets both and connects the app. |

The optional fields are pre-filled with `optional`; leave them like that and the
feature stays off. You can add any key later under Settings → Environment
Variables and redeploy. The database schema and the storage buckets are
created during the build. Open the deployment and create an account; the first
one becomes the administrator.

Free Supabase projects pause after a week without use. If your app stops
loading after a quiet week, open the project in the Supabase dashboard and
click **Restore**.

**Updates come to you.** After your first sign-in, the app asks once to
**Turn on** automatic updates: it opens GitHub with the update check ready,
and you click **Commit changes**. From then on your copy checks every week.
When there is a new version, GitHub emails you a short guide: try the preview
Vercel builds, then click **Merge**. Nothing changes in your live app until
you do.

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

## See it in action

<table>
<tr>
<td width="50%" valign="top"><img src="docs/assets/demo-web-search.webp" alt="A chat that searches the web and answers with sources" width="100%" /><br /><sub><b>Web search</b> with sources, right in the chat (with the optional Exa key).</sub></td>
<td width="50%" valign="top"><img src="docs/assets/demo-chart.webp" alt="A chat that answers with a bar chart" width="100%" /><br /><sub><b>Charts and tables</b> from a single sentence.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/assets/demo-code.webp" alt="A chat that runs Python and shows the result as a table" width="100%" /><br /><sub><b>Code execution</b> in a sandbox (optional E2B key), results as an interactive table.</sub></td>
<td width="50%" valign="top"><img src="docs/assets/demo-agent.webp" alt="Mentioning an agent with @ and getting a researched answer" width="100%" /><br /><sub><b>Agents</b>: mention one with <code>@</code> and it takes over.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/assets/demo-image.webp" alt="A chat that generates a watercolor image" width="100%" /><br /><sub><b>Image generation</b> inside the conversation.</sub></td>
<td width="50%" valign="top"><img src="docs/assets/demo-mcp.webp" alt="Connected apps and the catalog of tools to connect" width="100%" /><br /><sub><b>Tools and MCP servers</b>: connect your apps (catalog via the optional Composio integration).</sub></td>
</tr>
</table>

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

**Desktop app (beta for self-hosting).** The keinsaas Navigator desktop app
([download at keinsaas.com](https://keinsaas.com)) adds local (stdio) MCP servers, which a server on Vercel cannot run, plus
native notifications. On first launch it asks where to connect: pick **My own
server** and enter your instance's address, e.g. `https://my-chatbot.vercel.app`.
Connecting it to a self-hosted instance is in beta; tell us in
[Discord](https://discord.gg/9dwdAYKBPp) what works and what does not. You can
switch servers any time under **Change Server…** in the app menu.

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
retention. The Community Edition talks to TensorX directly rather than through a
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

This repository is the Community Edition of
[keinsaas Navigator](https://keinsaas.com), formerly known as better-chatbot. The
repository keeps its name, so existing links, forks and automatic updates keep
working. Everything above is here, in full,
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
