-- Apply after cursor_events.sql on existing databases
ALTER TABLE cursor_events ADD COLUMN IF NOT EXISTS composer_mode TEXT;
ALTER TABLE cursor_events ADD COLUMN IF NOT EXISTS model_id TEXT;
ALTER TABLE cursor_events ADD COLUMN IF NOT EXISTS subagent_type TEXT;
ALTER TABLE cursor_events ADD COLUMN IF NOT EXISTS is_background_agent BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_cursor_events_subagent_type ON cursor_events (subagent_type);
CREATE INDEX IF NOT EXISTS idx_cursor_events_composer_mode ON cursor_events (composer_mode);
CREATE INDEX IF NOT EXISTS idx_cursor_events_model_id ON cursor_events (model_id);
