# Layout — Project detail, Brain tab

Component: `apps/web/src/components/projects/project-brain-tab.tsx`
(data: `GET /api/projects/{id}/brain`)

```
┌ Sources ──────────────[+ Add source]┐ ┌ Connected tools ──────[+ Add tool]┐
│ DOCUMENTS (n)                       │ │ ┌──────┐ ┌──────┐ ┌──────┐        │
│ ┌doc card┐ ┌doc card┐  (status,     │ │ │Gmail │ │GCal  │ │GitHub│  grid  │
│ └────────┘ └────────┘   download)   │ │ │conn. │ │needs │ │conn. │  3 / 5 │
│                                     │ │ │[⟳][✕]│ │ auth │ │[⟳][✕]│        │
│ TRANSCRIPTS (n)                     │ │ └──────┘ └──────┘ └──────┘        │
│ ┌ text preview + timestamp ┐        │ │  per tool: ⟳ Sync · ✕ Remove      │
│ └───────────────────────────┘       │ └───────────────────────────────────┘
│ "N memory sources ingested"         │
└─────────────────────────────────────┘
┌ Recent memory ──────────────────────────────────────────────────────────┐
│ ┌ page: title + summary ┐  ┌ page: title + summary ┐   md:grid-cols-2   │
└─────────────────────────────────────────────────────────────────────────┘
```

| Element | Position | Wired to |
| --- | --- | --- |
| `+ Add source` | Sources card header (editors) | opens `ProjectAddSourceDialog`: **Upload files** → existing `ProjectUploadDialog` (TUS → `POST …/process-upload`; PDF, CSV, TXT, MD) · **Paste text** → `POST /api/projects/{id}/sources/text` `{title?, text}` |
| Documents grid | Sources card | `ProjectDocumentsGrid` (embedding status poll via `GET …/status`, download per card) |
| Transcripts list | Sources card | read-only latest voice transcripts from the brain payload |
| `+ Add tool` | Tools card header (editors) | opens `ProjectAddToolDialog` hosting the shared `ProjectToolPicker` (same as onboarding) |
| Tool card `⟳` | each tool card | `POST /api/projects/{id}/tools/{toolId}/sync` (Idempotency-Key) |
| Tool card `✕` | each tool card | `DELETE /api/projects/{id}/tools/{toolId}` |
| Recent memory | full-width bottom | brain pages (`ProjectBrainPageTable`) |

Paste-text ingestion (`POST /api/projects/{id}/sources/text`):

1. Stores the text as a `document` row with local chunks + embeddings
   (`processProjectDocument`), so the brain can always read it.
2. Mirrors the text into the project's Agentset namespace when
   `AGENTSET_API_KEY` is configured (best-effort).
3. Enqueues a project-brain run (`sourceType: "document"`,
   trigger `document_ingested`) → extraction updates memory pages, todos,
   status and widgets.
