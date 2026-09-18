-- WBS hour-level schedule. NULL means "use UI defaults" (09:00 / 18:00).
ALTER TABLE tasks ADD COLUMN start_time TEXT;
ALTER TABLE tasks ADD COLUMN end_time TEXT;
