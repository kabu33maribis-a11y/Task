CREATE TABLE IF NOT EXISTS cursor_events (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL,
  event_type TEXT,
  session_id TEXT,
  tool_name TEXT,
  model TEXT,
  duration_ms DOUBLE PRECISION,
  input_tokens INTEGER,
  output_tokens INTEGER,
  file_path TEXT,
  command TEXT,
  composer_mode TEXT,
  model_id TEXT,
  subagent_type TEXT,
  is_background_agent BOOLEAN,
  project TEXT,
  summary JSONB,
  event JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cursor_events_session_id ON cursor_events (session_id);
CREATE INDEX IF NOT EXISTS idx_cursor_events_recorded_at ON cursor_events (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_cursor_events_event_type ON cursor_events (event_type);
