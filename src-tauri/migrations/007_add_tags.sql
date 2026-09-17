CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER,
  created_at TEXT,
  updated_at TEXT
);
