-- 毎月のタスクなどを素早く追加するためのテンプレート
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT,
  project_id TEXT,
  priority TEXT,
  day_of_month INTEGER,
  subtasks TEXT,
  checklist TEXT,
  sort_order INTEGER,
  created_at TEXT,
  updated_at TEXT
);
