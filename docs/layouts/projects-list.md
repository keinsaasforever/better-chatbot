# Layout — `/projects` list

Route: `apps/web/src/app/(chat)/projects/page.tsx`

```
┌──────────────────────────────────────────────────────────┐
│ Projects                                 [+ New Project] │
│                                                          │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│ │ name       │ │ name       │ │ name       │  responsive │
│ │ description│ │ description│ │ description│  card grid  │
│ └────────────┘ └────────────┘ └────────────┘             │
└──────────────────────────────────────────────────────────┘
```

| Element | Position | Wired to |
| --- | --- | --- |
| `+ New Project` | header right | opens `ProjectDialog` (see `project-create-dialog.md`) |
| Project card | grid | navigates to `/projects/{id}` |

Unchanged in this iteration. Prototype parity targets for a later pass
(`prototype/src/views/projects/ProjectsView.tsx`): progress ring, member
avatar stack, agent chips, workflow count pill on each card.
