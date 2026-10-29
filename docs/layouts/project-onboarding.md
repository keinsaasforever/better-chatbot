# Layout — Project onboarding drawer

Components: `project-onboarding-drawer.tsx` → `project-onboarding-content.tsx`
(top drawer, opened by `/projects/{id}?onboard=1` right after creation)

```
(Goal) (Documents) (Tools) (People) (Agents)   ← step pills, clickable
──────────────────────────────────────────────
step content
──────────────────────────────────────────────
[Back]                          [Next / Finish setup]
```

| Step | Collects | Wired to |
| --- | --- | --- |
| Goal | free-text goal | `POST /api/projects/{id}/onboard` on finish |
| Documents | file uploads | `ProjectUploadDialog` → TUS → `POST /api/projects/{id}/process-upload` |
| Tools | Composio toolkits | shared `ProjectToolPicker` (below) |
| People | names list | `POST /api/projects/{id}/onboard` on finish |
| Agents | — (stub) | informational only |

## Tools step (`ProjectToolPicker`, shared with the Brain tab)

```
[🔍 Search tools…]
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   grid-cols-3
│ logo │ │ logo●│ │ logo │ │ logo●│ │ logo │   lg:grid-cols-5
│ name │ │ name │ │ name │ │ name │ │ name │   (scrollable)
│[Conn.]│ │[Add] │ │[Conn.]│ │[✓ Added]│ …
└──────┘ └──────┘ └──────┘ └──────┘ └──────┘
"N tools added to this project"
```

| Element | Wired to |
| --- | --- |
| `Add` (account already connected) | `POST /api/projects/{id}/tools` `{providerType:"composio", providerRef, connectionRef, displayName}` → fire-and-forget `POST …/tools/{toolId}/sync` |
| `Connect` (no account yet) | `POST /api/connections` → OAuth popup → poll refreshed `GET /api/connections` for the new `connectedAccountId` → attach as above |
| `✓ Added` badge | toolkit already attached (`GET /api/projects/{id}/tools`) |

Notes:

- `connectionRef` (the Composio connected-account id) is now sent by the
  client; the server also resolves the newest active account itself when the
  id is missing, so attaching right after OAuth can no longer fail with
  `invalid_connector`.
