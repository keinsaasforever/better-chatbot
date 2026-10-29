# Cockpit

`/cockpit` is the flight-deck view of the business inside Navigator: an
overhead panel of business systems, a windshield, a glareshield with the
headline numbers, display pedestals (marketing, channels, engines, finance)
and an UPDATES display. Every instrument is either **live** or **INOP** with
a reason. Nothing is estimated.

Any signed-in user can open it. Each user or organization connects their own
sources under **CONNECT**. Provider credentials never go in env vars.

The plan this was built from is `docs/cockpit-plan-2026-10-06.md`.

## Architecture

```
                  ┌──────────────────────── app/(chat)/cockpit/page.tsx
 browser ────────►│  getCockpitData(scope)            (server component)
                  └──────────────┬─────────────────────────────────────────
                                 │
   voice orb    ──► /api/voice/tool ──► runTool() ─┐
   (COM 1 · PTT)                                    │   lib/navigator-tools
   MCP client  ──► /api/navigator-mcp ──► runTool() ┤   (one registry)
                                                    ▼
                                   cockpit_* tools ──► lib/cockpit/data.ts
                                                         (compact view)
                                                            │
                                                            ▼
                       lib/cockpit/feeds.ts  getCockpitData(scope)
                       • loads the scope's cockpit_connection rows
                       • opens each config (lib/crypto/secret-box.ts)
                       • runs every provider in parallel, each under its deadline
                       • caches the result 60 s per scope + config version
                       • raises alerts (lib/cockpit/alerts.ts) → notifications
                                                            │
                     ┌──────────┬─────────┬────────┬────────┼─────────┐
                     ▼          ▼         ▼        ▼        ▼         ▼
                  website    vercel    stripe   revolut  superlog    seo
                  (Supabase) (REST)    (REST)   (REST)   (MCP)       (MCP)
                     lib/cockpit/providers/<name>.ts
```

- **One read path.** The page and the `cockpit_*` tools both call
  `getCockpitData(scope)`, so voice, MCP and the UI always agree.
  `lib/cockpit/data.ts` folds the result for the tools:
  - lists are capped at 10, and latest-N lists at 5;
  - the breakdown tables and the daily series stay out;
  - money is in major units;
  - INOP reasons are in plain English.

  The realtime voice model re-reads tool output every turn.
- **Scope.** A scope is the active organization, or the user alone when no
  organization is active. Org rows are read only while the user is still a
  member, and a null org falls back to the user's own rows (fail closed).
- **Nothing throws to the page.** A missing, disabled, undecryptable or
  failing source is `{ status: "inop", reason }`. The reason is a stable code
  (`lib/cockpit/reasons.ts`), translated in `Cockpit.reasons.*`, and also
  stored in `cockpit_connection.last_error`. Reasons are built by our own
  code, never copied from a provider's response body.
- **UPDATES** rows are ordinary notifications. Severity rides on the type:
  `cockpit_update` (info), `cockpit_update.warn` or `cockpit_update.alert`.
  `title` and `body` are plain text, because the header bell shows them
  verbatim. The display polls
  `/api/notifications?type=cockpit_update,cockpit_update.warn,cockpit_update.alert`
  every 5 s. A `cockpit_push_update` from the voice session also fires
  `cockpit:update` on `window`, so the row shows up before the next poll.
- **Voice.** COM 1 · PTT in the header opens a small floating voice orb
  (`components/cockpit/voice-orb`, three.js) instead of the full-screen
  drawer, with `context: "cockpit"`, which appends
  `buildCockpitOversightPrompt()` to the realtime instructions. The orb
  connects by itself once the MCP list is in, and the copilot speaks first:
  the prepare call returns `buildCockpitGreetingPrompt()` ("Hi <name> Sir.")
  and the hook sends it as the instructions of the opening response. Drag
  the orb anywhere (the spot is remembered per browser, arrow keys move it
  too); hover, or a tap on touch, shows the X that hangs up. There is no
  transcript on screen; the conversation is still saved to a chat thread,
  and a browser run opens its live view in a panel beside the orb.

## Setup

1. Set `APP_SECRETS_KEY` (see `.env.example`). It is a 32-byte base64 key:

   ```sh
   openssl rand -base64 32
   ```

   Connections are sealed with AES-256-GCM under it. Without it, production
   derives the key from `BETTER_AUTH_SECRET`, so rotating that secret then
   makes stored connections unreadable too. With neither, production refuses
   to store or read connections, and every feed shows INOP "Encrypted
   connections are unavailable". Set the same key in every environment that
   shares a database: one that derives its own key writes connections the
   others cannot read. Development falls back to a
   fixed, insecure key. Rotating the key makes stored connections unreadable;
   re-enter them in CONNECT.
2. Apply the migrations `0065_api_key.sql` and `0066_cockpit_connection.sql`, after the workflow-generator migrations 0062 to 0064.
   Production migrations are applied manually in Supabase.
3. Open `/cockpit`, press **CONNECT**, and enter a provider's fields. **Test**
   probes without saving. **Save** stores the config, then probes again so the
   LED is right immediately. Secret fields left blank on a later edit keep
   their stored value. The API never returns a secret, only the names of the
   secret fields that are set.

## Providers

| Provider | Fields | Feeds | Deadline |
|---|---|---|---|
| `website` | `supabaseUrl`, `supabaseSecretKey`, `rangeDays` (1–90, default 30) | Marketing PFD, channels, landing pages, lead log, FCU visits/leads/conversion | 4 s |
| `vercel` | `token`, `teamId?` (id or slug; blank resolves it from the token), `projects` (one `LABEL = prj_…`, bare id or name per line, up to 6) | ENGINES deploy state, FCU deploys | 4 s |
| `stripe` | `restrictedKey` (`rk_live_…` / `rk_test_…`) | MRR, balance, payments 30 d, failed payments 7 d, next payout | 4 s |
| `revolut` | `clientId`, `privateKeyPem`, `authorizationCode` (once) or `refreshToken`, `issuer?`, `sandbox`, `largeTransactionThreshold` (default 5000) | Balances per currency, inflow/outflow 30 d, recent transactions | 4 s |
| `superlog` | `mcpUrl`, `token` (`superlog_pat_…`) | Open incidents, incidents 24 h, firing alerts, errors 24 h, per service | 6 s |
| `seo` | `kind` (`openseo` / `dataforseo`), `domain`, `mcpServerId` (a Navigator MCP server; required for OpenSEO) or `login` + `password` + `mcpUrl?` (DataForSEO), `locationName?`, `languageCode?` | Organic traffic, keyword count, top keywords with position change, referring domains | 6 s |

### website

This reads the marketing site's first-party `site_events` table from its own
Supabase project. Use that project's URL and a secret (service) key. The
marketing site keeps the `/api/collect` beacon. Browsers carrying
`ks_internal=1` are dropped by the collector; on the cockpit, that cookie
only lights a 6 px LED next to the UTC clock.

### vercel

Create a token with read access to the projects. Leave `teamId` blank: the
provider finds the account that owns the first project (the token's own scope,
then each of its teams) and caches it per config version. Hobby projects live
in a default team ("<name>'s projects"), so a blank team used to miss them. A
value starting with `team_` is sent as `teamId`, anything else as `slug`. Each
project line becomes one ENGINES column. Superlog incidents are
matched onto a column by service name (key or label). With a single project,
the column gets Superlog's totals.

### stripe

Create a **restricted key** with read access to Balance, Charges,
Subscriptions and Payouts. Amounts are reported in the account currency.

### revolut

Revolut Business uses OAuth with a signed client assertion, and it issues a
refresh token only through a one-time consent step:

1. In Revolut Business, go to *Settings → APIs → Business API* and add a
   certificate:
   - Generate a key pair:

     ```sh
     openssl genrsa -out privatecert.pem 2048
     openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825
     ```

   - Upload `publiccert.cer`.
   - Set the OAuth redirect URI to a domain you control, e.g.
     `https://app.keinsaas.com`.

   Revolut shows the **client id**.
2. On the same certificate, press *Enable access* and approve the consent
   screen. Revolut redirects to the redirect URI with `?code=…`. That
   **authorization code** is valid for about two minutes.
3. In CONNECT → Revolut, enter the client id, paste the contents of
   `privatecert.pem` into the private key field, and paste the code into
   **authorization code**.
   - Set **issuer** to the redirect URI's domain if it isn't this app's host.
   - Tick **sandbox** for `sandbox-b2b.revolut.com`.

   Save once. On save the code is exchanged (`grant_type=authorization_code`)
   for a refresh token. Only the refresh token is stored; the code never is.

After that, each fetch signs an RS256 JWT (`iss` = issuer, `sub` = client id,
`aud` = `https://revolut.com`, 60-minute expiry). It exchanges the JWT with
the refresh token for a 40-minute access token, which is cached per
connection.

Refresh tokens on the Freelancer plans expire after 90 days. The feed then
shows INOP "Authorization expired: reauthorize in CONNECT". Repeat step 2 and
paste the new code.

### superlog

Superlog is read through its hosted MCP server:
- **URL:** `https://api.superlog.sh/mcp`.
- **Token:** a personal access token (`superlog_pat_…`, Superlog → Settings →
  MCP tokens), sent as `Authorization: Bearer <token>`. The ingest key
  (`sl_public_…` / `superlog_live_…`) is rejected by the MCP server; the
  provider recognises it and shows "Wrong key type" instead of connecting.

The provider calls `tools/list` once per config version, then
`search_incidents`, `list_alerts` and `query_logs`. Argument shapes are read
from the tool schemas, and a missing tool shows INOP with its name.

### seo

Pick a `kind`:
- **OpenSEO:** signs in with OAuth only, so it runs over an MCP server
  connected in Navigator. Add `https://app.openseo.so/mcp` under MCP servers,
  authorize it, then pick it in CONNECT (`mcpServerId`). Navigator's MCP
  client keeps the OAuth tokens and refreshes them. The server is resolved as
  the connection's owner in its workspace (their own server, or one shared in
  the workspace), for the probe on save and for every refresh alike.
- **DataForSEO:** login and password. Defaults to
  `https://mcp.dataforseo.com/v3/mcp`. It can also run over a picked MCP
  server.

Tools are matched by name pattern and introspected once per connection. A
domain is bare (`example.com`).

## Troubleshooting

- **Connections look gone.** They belong to the active workspace, not to the
  user. A deploy never removes them: they live in `cockpit_connection` under
  the same `APP_SECRETS_KEY`. They look gone after switching workspace, or
  after signing in on another domain (a Vercel preview URL), where the new
  session opens the default workspace. CONNECT names the active workspace and,
  when it is empty, says which other workspace holds connections.
- **Every connection INOP "Encrypted connections are unavailable".**
  `APP_SECRETS_KEY` (and `BETTER_AUTH_SECRET`) is missing in that environment,
  or the key changed. Changing it makes stored connections unreadable;
  re-enter them.
- **Superlog or SEO INOP.** The reason comes from the MCP response: "Credentials
  rejected" is a 401/403 (wrong key), "HTTP 404" a wrong MCP URL, "Provider
  unreachable" a network failure. "No usable MCP server" means the picked
  Navigator MCP server is gone, disabled or not visible to the connection's
  owner; "needs authorization" means its OAuth session has to be authorized
  again under MCP servers. Failed probes and feed state changes are logged to
  Superlog as `[cockpit] …`, see `docs/observability.md`. The
  SDK keeps the HTTP status on the error's `code`, not in its message, and
  `mcpReason` reads it from there.

Credentials stay in CONNECT, not in Vercel env vars: they are per workspace,
and env vars would apply to every user and need a redeploy for each change.

## Alert rules

`lib/cockpit/alerts.ts` runs after every feed refresh. It posts to the
UPDATES display (and push) of the user who owns the provider connection.

| Source | Condition | Severity | Dedupe key |
|---|---|---|---|
| Vercel | latest deployment of a project in state `ERROR` | alert | `vercel:<deployment id>` |
| Superlog | open incident (up to 5 per refresh) | alert if `SEV-1`, else warn | `superlog:<incident id>` |
| Stripe | failed charge in the last 7 days (up to 5) | warn | `stripe:<charge id>` |
| Revolut | transaction with \|amount\| ≥ `largeTransactionThreshold` (0 turns it off) | info | `revolut:<transaction id>` |

The notification table's `(user_id, dedupe_key)` index makes a replay insert
nothing and push nothing, so no snapshot table is needed. A 24-hour
`serverCache` gate (Redis when configured, else in memory) also stops the
same event from reaching the DB again on every refresh.

The voice copilot's `cockpit_summary` returns an `attention` list:
- failing deploys;
- open incidents;
- failed payments;
- website visits down 30 % or more week on week.

The copilot prompt tells it to lead with these.

## Navigator MCP server

`/api/navigator-mcp` serves the Navigator tool registry (agents, chat,
projects, workflows, scheduled tasks, skills, cockpit) over stateless
Streamable HTTP. Each tool runs with an actor built from the credential,
never from the tool's arguments.

Create an API key with the session cookie of a signed-in user. There is no UI
for it yet. The key acts in the organization that was active when it was
minted, and membership is re-checked on every request:

```sh
curl -X POST https://app.keinsaas.com/api/cockpit/api-keys \
  -H "Content-Type: application/json" -H "Cookie: <session cookie>" \
  -d '{"name":"Claude Desktop","expiresInDays":90}'
```

The response shows the key once. `GET` lists your keys (without secrets), and
`DELETE` with `{"id":"…"}` revokes one.

Client config for a client that speaks Streamable HTTP with headers (Cursor,
Claude Code and similar):

```json
{
  "mcpServers": {
    "keinsaas-navigator": {
      "type": "http",
      "url": "https://app.keinsaas.com/api/navigator-mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

For a client that only speaks stdio (e.g. the Claude Desktop config file),
bridge it:

```json
{
  "mcpServers": {
    "keinsaas-navigator": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://app.keinsaas.com/api/navigator-mcp",
        "--header",
        "Authorization: Bearer <key>"
      ]
    }
  }
}
```

To smoke-test, run the following; it should list 25 or more tools:

```sh
curl -X POST https://app.keinsaas.com/api/navigator-mcp \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The same request without the header returns 401.

## Adding a provider

1. Add the name to `COCKPIT_PROVIDERS` and its summary type to
   `lib/cockpit/types.ts`, then add a `Feed<…>` field to `CockpitData`.
2. In `lib/cockpit/providers/schemas.ts`:
   - add a zod config schema to `PROVIDER_CONFIG_SCHEMAS`;
   - add its form fields to `PROVIDER_FIELDS`. Mark secrets as `secret` or
     `secretTextarea` so they are redacted and kept on blank edits. Mark
     one-time inputs as `transient`.
3. Create `lib/cockpit/providers/<name>.ts`, exporting a
   `CockpitProviderModule`:
   - `configSchema`;
   - `deadlineMs`;
   - `probe(config, ctx)` → `{ ok } | { ok: false, reason }`;
   - `fetch(config, ctx)` → `Feed<T>`;
   - optionally `prepare` (e.g. to exchange a one-time code on save).

   Use `ctx.signal` on every request, and map failures with `httpReason` /
   `errorReason`. Never echo a provider's response text into a reason.
   Register the module in `providers/index.ts`.
4. Run it in `refresh()` in `lib/cockpit/feeds.ts`, wire it into the shell and
   its console, and, if voice should hear it, add it to `lib/cockpit/data.ts`
   (compact, capped lists).
5. If the source has events worth an alert, add a rule to `collectAlerts`. It
   needs a stable event id; the dedupe key is `<provider>:<eventId>`.
6. Add the strings to all 8 `messages/*.json` (`Cockpit.connect.*`,
   `Cockpit.reasons.*`). Add tests: `probe`/`fetch` with a mocked `fetch`
   (one happy path, one auth failure), plus the alert rule.

No migration is needed: `cockpit_connection.provider` is a `varchar(32)`, and
the unique index is per scope and provider.

## Follow-ups

- **Plaintext MCP headers at rest.** `mcp_server.config.headers`, the
  credentials of the user's own MCP client connections, are still stored in
  plain text. Cockpit connections are sealed; MCP server configs should move
  to the same secret box.
- **Hold-to-talk on COM 1.** The realtime hook already supports push-to-talk
  (`ptt`, `pushToTalkStart`/`pushToTalkEnd`), and the orb no longer covers
  the key, so COM 1 could drive PTT while a session runs.
- **Real audio levels on the orb.** The orb animates from the session's
  speaking flags, not from loudness: the AI SDK plays audio through a private
  `AudioContext` with no analyser, and metering the mic would need the hook
  to expose its stream.
- **API keys UI.** Keys are minted through the API only.
- **Spend and margin** on ENGINES stay INOP until a cost source exists.
