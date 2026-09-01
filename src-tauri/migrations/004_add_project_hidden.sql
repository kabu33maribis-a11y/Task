-- Project visibility: hidden projects are omitted from console / WBS / filters.
ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
