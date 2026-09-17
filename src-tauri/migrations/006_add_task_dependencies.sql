CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY,
  predecessor_id TEXT NOT NULL,
  successor_id TEXT NOT NULL,
  created_at TEXT,
  UNIQUE(predecessor_id, successor_id)
);
