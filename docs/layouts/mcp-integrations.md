# Layout — `/mcp` Integrations page

Component: `apps/web/src/components/mcp-dashboard.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│ MCP & Tools                    [logo stack]  [⚡ Connect Tools]   │
│                                                                  │
│ Connected Apps (4) ────────────────────────────────  [Add more]  │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                              │
│ │ 🅼  ● │ │ 📅 ● │ │ 🗄  ● │ │ 🐙 ● │             grid-cols-3        │
│ │Gmail │ │GCal  │ │Drive │ │GitHub│             sm:grid-cols-4    │
│ │Disc. │ │Disc. │ │Disc. │ │Disc. │             lg:grid-cols-5    │
│ └──────┘ └──────┘ └──────┘ └──────┘                              │
│                                                                  │
│ Developer Section ──────────────────────────────────             │
│ [New Server tile] [MCP server cards…]   (unchanged)              │
└──────────────────────────────────────────────────────────────────┘
```

| Element | Position | Wired to |
| --- | --- | --- |
| `⚡ Connect Tools` | header right | opens the Composio browse drawer (`ComposioDrawer`) |
| `Add more` | Connected-Apps header right | opens the same drawer |
| Connected app card | grid cell (vertical: logo, name, green dot) | data from `GET /api/connections` (`isConnected`) |
| `Disconnect` | bottom of each card | `POST /api/connections/disconnect` `{connectedAccountId}` |
| Drawer cards `Connect` | drawer grid | `POST /api/connections` `{toolkit}` → OAuth redirect |

Notes:

- The connected list is reconciled server-side against Composio
  `connectedAccounts.list`, so every account-connected toolkit shows even when
  the toolkit flags lag (fixes the "4 connected, 2 shown" bug).
- Grid: 3 per row on mobile, 4 from `sm`, 5 from `lg`.
