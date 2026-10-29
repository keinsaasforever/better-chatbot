-- Drop the per-source dashboard widgets.
--
-- `project_widget` held one row per (project, source scope, slot): every
-- connected tool, document and chat wrote its own "todos" and "status" slot
-- plus model-generated table/metric cards, so the Overview showed the same
-- card several times and mirrored raw tool data. The Overview now reads the
-- consolidated `project_status_snapshot` + `project_todo` rows written by
-- the consolidation step (0056), and nothing writes or reads this table any
-- more.
DROP TABLE IF EXISTS "project_widget";
