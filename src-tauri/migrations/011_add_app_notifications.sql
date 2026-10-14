CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
