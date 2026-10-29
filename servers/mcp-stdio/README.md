# MCP stdio servers (Phase 6)

Local MCP servers launched via stdio from `apps/desktop` or developer tooling.

## Filesystem server

From the repo root after `pnpm install`:

```bash
pnpm --filter @keinsaas/mcp-stdio-filesystem start -- /path/to/allowed/root
```

Use **only** user-approved directories — never `$HOME` or `/` as a blanket root (see `docs/monorepo.md` §5.1 / §6).

Example desktop MCP config (stdio):

```json
{
  "command": "pnpm",
  "args": [
    "--filter",
    "@keinsaas/mcp-stdio-filesystem",
    "start",
    "--",
    "C:\\path\\to\\your\\project"
  ]
}
```
