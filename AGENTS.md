# Repository Guidelines

## Layout

pnpm + Turborepo workspace.

- `apps/web` — the Next.js app; almost all changes happen here
  - `src/app` (routes, API, middleware), `src/components` (UI),
    `src/lib` (auth, db, ai, storage), `src/hooks`
- `apps/desktop` — Electron shell (local MCP servers, filesystem, keychain)
- `packages/*` — shared MCP schemas and contracts; never import from `apps/web`
- `servers/mcp-stdio` — local-exec MCP server used by the desktop app
- `tests/` (end-to-end), `scripts/` (maintenance), `docker/`

Root commands pass through to `apps/web`, so `pnpm dev` and friends work from
the repository root.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run locally |
| `pnpm build` / `pnpm start` | Production build and run |
| `pnpm check` | Lint, typecheck, unit tests — the gate before every commit |
| `pnpm test` / `pnpm test:e2e` | Vitest / Playwright |
| `pnpm db:migrate` / `pnpm db:studio` | Apply migrations / browse the database |
| `pnpm db:check-parity` | Verify a journal replay matches the schema |
| `pnpm docker-compose:up` | Full local stack |

## Conventions

- **Verification gate:** `pnpm check` before every commit. Add `pnpm build` for
  changes to streaming, the schema, or the client/server boundary.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, …). Filenames
  are kebab-case. Biome formats and lints on commit.
- **Migrations are hand-written SQL** in `apps/web/src/lib/db/migrations/pg/`
  plus a matching `meta/_journal.json` entry. Do not run
  `drizzle-kit generate` — it produces drifted snapshots against this schema.
  A journal entry's timestamp must be newer than every entry before it, or the
  migration is silently skipped on databases that are already past it.
- **Auth:** API routes go through `withAuth` from `lib/auth/route-guard`.
  Repository reads and writes are scoped by user and workspace — do not widen
  them. Never return a raw error message from a 500 handler.
- **Chat history reads stay bounded** by `CHAT_MESSAGE_WINDOW` (`lib/const.ts`).
- **Streamed markdown** is split into block-stable units and memoized; keep
  per-update work proportional to the tail block, not the whole message.
- **Tests** cover the happy path plus one failure mode, and run without a
  database — mock `pgDb`.
