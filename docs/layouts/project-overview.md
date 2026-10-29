# Layout — Project detail, Overview tab

Route: `/projects/{id}` — `apps/web/src/components/projects/project-workspace.tsx`

```
┌──────────────────────────────────────────────────────────────┐
│ Project name                     [avatars] [⟳ Sync now]      │
│ goal / description                                           │
│                                                              │
│ (Overview) (Brain) (Graph)          ← tabs, ?tab= param      │
│                                                              │
│ ┌ widget ─────────┐ ┌ widget ─────────┐   md:grid-cols-2     │
│ │ table / metric  │ │ todos / status  │                      │
│ └─────────────────┘ └─────────────────┘                      │
│ ┌ Project chat ───────────────────────┐                      │
│ └─────────────────────────────────────┘                      │
│ [Old chats]                                                  │
└──────────────────────────────────────────────────────────────┘
```

| Element | Position | Wired to |
| --- | --- | --- |
| `⟳ Sync now` | header right (hidden for viewers) | `POST /api/projects/{id}/tools/{toolId}/sync` for **every** connected tool (was: first tool only); disabled while a run is queued/running (`GET …/runs/latest` poll) |
| Widgets | grid under the tabs | `GET /api/projects/{id}/widgets`, rendered by `ProjectNativeWidget` — all four kinds render natively now: `table`, `metric`, `todos` (checklist with priority/blocked badges), `status` (health badge, progress bar, blockers) |
| Project chat | below widgets | `ProjectChatWrapper` (project-scoped thread) |
| Old chats | bottom | `ProjectOldChats` |

See `docs/tool-widget-population.md` for how connected tools fill the widgets.
