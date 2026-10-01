CREATE TABLE IF NOT EXISTS tiers (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  position    INTEGER NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id           INTEGER PRIMARY KEY,
  parent_id    INTEGER REFERENCES modules(id),
  name         TEXT NOT NULL,
  display_name TEXT,
  description  TEXT,
  origin       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  key_exports  TEXT,
  dir_paths    TEXT,
  tier_id      INTEGER REFERENCES tiers(id),
  locked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS files (
  path       TEXT PRIMARY KEY,
  module_id  INTEGER REFERENCES modules(id)
);

CREATE TABLE IF NOT EXISTS edges (
  source_file  TEXT NOT NULL,
  target_file  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  PRIMARY KEY  (source_file, target_file, kind)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_file);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_file);
CREATE INDEX IF NOT EXISTS idx_files_module ON files(module_id);

CREATE TABLE IF NOT EXISTS module_relations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  module_a_id         INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  module_b_id         INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  direction           TEXT NOT NULL CHECK (direction IN ('a_to_b','b_to_a','both','shared')),
  category            TEXT NOT NULL CHECK (category IN ('depends','shares','observes','contracts')),
  label               TEXT NOT NULL,
  summary             TEXT NOT NULL,
  evidence_files      TEXT NOT NULL,
  fingerprint         TEXT NOT NULL,
  fingerprint_current TEXT,
  manual_override     INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE(module_a_id, module_b_id)
);

CREATE INDEX IF NOT EXISTS idx_module_relations_pair ON module_relations(module_a_id, module_b_id);

CREATE TABLE IF NOT EXISTS module_turn_summary (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  turn_index  INTEGER NOT NULL,
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  summary     TEXT NOT NULL,
  file_paths  TEXT NOT NULL,
  finalized   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(session_id, turn_index, module_id)
);

CREATE INDEX IF NOT EXISTS idx_turn_summary_recent ON module_turn_summary(module_id, turn_index DESC);
CREATE INDEX IF NOT EXISTS idx_turn_summary_session_turn ON module_turn_summary(session_id, turn_index);
