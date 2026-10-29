# Project overview: status, to-dos and notifications

How connected tools (Composio / MCP), documents, transcripts and chats feed
the **one Status card and one To-dos card** on a project's Overview tab, and
when a project member gets notified. Design principle: **every source is
judged against the project's goal, description and instructions** and merged
into a single project-level view. Nothing mirrors a tool; a calendar is not a
widget and an inbox is not a status.

## Pipeline

```
attach / manual sync / daily dream cycle / document upload / chat close
        │  POST /api/projects/{id}/tools/{toolId}/sync (and friends)
        ▼
ProjectBrainRunTable row  ──►  Inngest project-brain-ingest-run
        │
        ▼
1. GATHER   lib/project-brain/run-source.ts
   • loads the connector's read-only actions; the model calls them WITH
     project-scoped parameters derived from name + goal + description
   • tool results are classified (lib/project-brain/tool-result.ts): failed
     envelopes (Composio `successful:false`, MCP `isError`) never enter the
     source text. All failed + auth-looking error → run fails with
     `connection_not_active`, the connector flips to `needs_auth`
   • persists the raw source
        │
        ▼
2. EXTRACT  lib/project-brain/analyze-persisted-source.ts
   • one structured call → entities / relations / timeline plus the
     per-source SIGNALS: summary, status, todos (with dueAt, sourceUrl)
   • signals are stored on the raw source (`extraction_signals`) so the next
     stage never re-reads raw text
        │
        ▼
3. PERSIST + MATERIALIZE   persist-extraction.ts, materialize-run.ts
   • pages, facts, links, aliases, page versions; timeline → project_brain_event
   • compiled truth re-embedded for chat retrieval
        │
        ▼
4. CONSOLIDATE   lib/project-brain/consolidate-project.ts  (3 Inngest steps)
   consolidate-generate  one call over: project context, latest signals per
                         source scope (≤12), open to-dos, recently closed
                         keys, previous {health, summary}
                         → ConsolidationSchema {health, summary, blockers,
                           todos[{key, notify, …}], resolvedKeys}
   consolidate-apply     one transaction: mergeTodos() → insert / update /
                         close; snapshot row in project_status_snapshot
                         (unique per run)
   notify                one "project_digest" notification per member
                         (bell + web push), deduped per run
        │
        ▼
5. RENDER   components/projects/project-status-card.tsx, project-todos-card.tsx
   • GET /api/projects/{id}/overview → {status, connectorIssues, todos, recentlyDone}
   • PATCH /api/projects/{id}/todos/{todoId} {status: open|done|dismissed}
```

## Rules the merge enforces (`merge-todos.ts`)

| Situation | Outcome |
| --- | --- |
| New key from the model | inserted as `open`; notified if `notify: true` |
| Key matches an open row | fields refreshed, `last_seen_at` bumped; notified once if the model now flags it |
| Key matches a `done` / `dismissed` row | ignored: the user's decision wins over every later sync |
| Key listed in `resolvedKeys` | open row closed (`done`, `resolved_by_user_id` null) |
| Tool detached | its open to-dos are dismissed |

A to-do notifies at most once ever (`notified_at`). Health notifies only on a
transition between two known values.

## Failure posture

- Consolidation errors mark the run `partial` with a `consolidation_failed`
  warning; the knowledge write is never rolled back.
- Connector problems are surfaced as `connectorIssues` on the Overview and as
  the connector status on the Brain tab. They are never to-dos, blockers or
  health reasons (the prompt says so explicitly, and failed payloads are
  filtered before extraction).

## Refresh cadence

- **Attach-time**: the tool picker fires a sync right after attaching.
- **Manual**: per-tool `⟳` on the Brain tab; header `Sync now` syncs every
  connected tool.
- **Daily**: the dream cycle (`project-brain-dream-cycle.ts`) enqueues a
  `tool_sync` run per connector. Unchanged sources skip before extraction, so
  a project consolidates at most once per changed source per day.

## Knowledge graph (gbrain parity)

The consolidation reads a graph that is wired on every page write and
enriched nightly:

| Concern | Where | How |
| --- | --- | --- |
| Edge vocabulary | `edge-types.ts` | 14 typed relations (`works_at`, `attended`, `blocked_by`, …); model output is normalised, unknown types become `related_to` |
| Mention edges | `mention-links.ts`, `persist-extraction.ts` | after compiled truth is recomputed, aliases of other pages found in the text (or `[[wikilinks]]`) produce `mentions` links with evidence, no model call |
| Entity resolution | `alias-match.ts`, `resolveFuzzyPage` | trigram-close aliases, email or domain match resolve to the existing page (people, organizations); ambiguous → new page |
| Dedupe | `dedupe-pages.ts`, `merge-pages.ts` | nightly candidate pairs + one model call; confirmed pairs merged, rejected pairs remembered in frontmatter `notSameAs` |
| Queries | `graph-query.ts`, chat tool `queryProjectGraph` | entity + backlinks, bounded traversal (recursive CTE), shortest path, who-knows ranking |
| Retrieval | `retrieve-for-chat.ts`, `rank-fusion.ts` | RRF over vector + keyword hits, raw-source demotion, adjacency boost from hub pages, alias-resolved facts and relations in the prompt |
| Salience / archive | `salience.ts` | degree + facts + recency + source diversity; pages with nothing current for 30 days are archived, never deleted |
| Contradictions | `contradictions.ts` | same page + key, different values from different scopes → batched judge → `project_brain_contradiction`; open ones become status blockers and a Brain tab card |
| Dream cycle | `lib/inngest/functions/project-brain-dream.ts` | 06:30 UTC scheduler + `POST /api/projects/{id}/brain/dream`; records a `dream:` run row |

Graph tab: `project-knowledge-graph.tsx` lays nodes out with d3-force, filters
by kind, searches, focuses on a node (`?focus=&depth=`) and shows links,
backlinks, aliases and merged duplicates.

Migration `0060_graph_parity.sql` adds `pg_trgm`, page `salience` /
`archived_at` / `merged_into_page_id`, trigram indexes and the contradiction
table.

## Known limitations

- Notification copy is English (Inngest has no request locale).
- Marking a to-do done does not write back to the source tool.
- gbrain's `think` (cited synthesis with gap analysis) is not implemented;
  chat citations still come from the Agentset document path.
