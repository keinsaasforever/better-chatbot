# Layout — Project creation dialog (first popup)

Component: `apps/web/src/components/projects/project-dialog.tsx`

```
┌─ New project ──────────────────────────────┐
│ [Project name…]                 (Input)    │
│ [What is this project about?]   (Textarea) │
│ Retrieval profile               (Select ▾) │
│   Agentset managed (default)               │
│   OpenAI 3-large / 3-small                 │
│   Voyage / Google / Azure OpenAI           │
│   "Choose how this project indexes         │
│    uploaded documents via Agentset.        │
│    Cannot be changed after creation."      │
│ [        Create project        ]           │
└────────────────────────────────────────────┘
```

| Element | Position | Wired to |
| --- | --- | --- |
| Name / description | top | `POST /api/projects` body |
| Retrieval profile | above the submit button | `EmbeddingModelSelector` (`embedding-model-selector.tsx`), options from `lib/agentset/embedding-profile-options.ts`; sent as `embeddingProfile`, persisted to `project.agentset_embedding_profile` |
| `Create project` | full-width bottom | `POST /api/projects` → redirect `/projects/{id}?onboard=1` (opens the onboarding drawer) |

Notes:

- The chosen profile drives the lazy Agentset namespace provisioning
  (`ensureProjectAgentsetNamespace` reads the stored column on first
  upload/search). It is locked after creation — changing it would require
  re-indexing into a new namespace.
