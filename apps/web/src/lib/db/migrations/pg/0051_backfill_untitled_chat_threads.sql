-- Backfill titles for threads that were left untitled.
--
-- Title generation ran client-side only and persisted through a fire-and-forget
-- write in a streaming `onEnd` callback. The client refetched `/api/thread` as
-- soon as the response stream closed, and on Vercel the function could be
-- frozen before the write landed at all — so a large share of threads kept
-- `title = ''` permanently and the sidebar rendered them as "New Chat" forever.
-- The code paths are fixed; this repairs the rows already written.
--
-- Data only, no DDL. The title is taken from the thread's first user message,
-- which is exactly the seed the model would have been given. It is a plain
-- truncation rather than a generated title: this runs in a migration with no
-- model available, and a truncated first message is what the application itself
-- falls back to when generation fails.
--
-- `chat_message.parts` is `json[]` (a Postgres array of json values), hence
-- `unnest` rather than `jsonb_array_elements`. Only rows still holding the
-- empty string are touched, so re-running this is a no-op.
UPDATE chat_thread AS t
SET title = s.title
FROM (
  SELECT DISTINCT ON (m.thread_id)
    m.thread_id,
    left(btrim(p ->> 'text'), 80) AS title
  FROM chat_message AS m
  CROSS JOIN LATERAL unnest(m.parts) AS p
  WHERE m.role = 'user'
    AND p ->> 'type' = 'text'
    AND btrim(coalesce(p ->> 'text', '')) <> ''
  ORDER BY m.thread_id, m.created_at ASC, m.id ASC
) AS s
WHERE t.id = s.thread_id
  AND btrim(t.title) = '';
