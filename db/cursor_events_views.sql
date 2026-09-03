-- Grafana 用ビュー（cursor_events テーブル作成後に実行）
-- Usage: psql -h 172.16.57.201 -U postgres -d postgres -f db/cursor_events_views.sql

CREATE OR REPLACE VIEW v_cursor_tool_usage AS
SELECT
  id,
  recorded_at,
  session_id,
  tool_name,
  duration_ms,
  model,
  project
FROM cursor_events
WHERE event_type = 'postToolUse'
  AND tool_name IS NOT NULL;

CREATE OR REPLACE VIEW v_cursor_sessions AS
SELECT
  id,
  recorded_at,
  session_id,
  event_type,
  project
FROM cursor_events
WHERE event_type IN ('sessionStart', 'sessionEnd');

CREATE OR REPLACE VIEW v_cursor_tokens AS
SELECT
  id,
  recorded_at,
  session_id,
  input_tokens,
  output_tokens,
  model,
  project
FROM cursor_events
WHERE event_type = 'afterAgentResponse'
  AND (input_tokens IS NOT NULL OR output_tokens IS NOT NULL);

CREATE OR REPLACE VIEW v_cursor_subagents AS
SELECT
  id,
  recorded_at,
  session_id,
  event_type,
  subagent_type,
  model_id,
  composer_mode,
  project
FROM cursor_events
WHERE event_type IN ('subagentStart', 'subagentStop')
   OR subagent_type IS NOT NULL;

CREATE OR REPLACE VIEW v_cursor_recent_events AS
SELECT
  id,
  recorded_at,
  event_type,
  session_id,
  tool_name,
  subagent_type,
  composer_mode,
  model_id,
  duration_ms,
  input_tokens,
  output_tokens,
  project
FROM cursor_events
ORDER BY recorded_at DESC;
