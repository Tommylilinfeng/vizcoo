import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql')

export function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(schemaPath, 'utf8'))
  migrate(db)
  return db
}

function migrate(db: Database.Database): void {
  addModuleColumns(db)
  rebuildIfOldOriginCheck(db)
  rebuildFilesIfHasContentHash(db)
  rebuildEdgesIfHasKindCheck(db)
  renameLegacyOrigins(db)
  migrateTierToTiers(db)
}

function migrateTierToTiers(db: Database.Database): void {
  const cols = (db.pragma('table_info(modules)') as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('tier')) return
  if (!cols.includes('tier_id')) {
    db.exec('ALTER TABLE modules ADD COLUMN tier_id INTEGER REFERENCES tiers(id)')
  }
  const tierExists = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tiers'").get() as { name: string } | undefined)
  if (!tierExists) {
    db.exec(`
      CREATE TABLE tiers (
        id          INTEGER PRIMARY KEY,
        name        TEXT,
        position    INTEGER NOT NULL UNIQUE,
        created_at  TEXT NOT NULL
      );
    `)
  }
  const positions = (db.prepare('SELECT DISTINCT tier AS p FROM modules WHERE tier IS NOT NULL ORDER BY tier').all() as Array<{ p: number }>).map((r) => r.p)
  const now = new Date().toISOString()
  const insertTier = db.prepare("INSERT INTO tiers (name, position, created_at) VALUES (NULL, ?, ?)")
  const linkModule = db.prepare("UPDATE modules SET tier_id = ? WHERE tier = ?")
  for (const p of positions) {
    const existing = db.prepare('SELECT id FROM tiers WHERE position = ?').get(p) as { id: number } | undefined
    const tierId = existing ? existing.id : (insertTier.run(p, now).lastInsertRowid as number)
    linkModule.run(tierId, p)
  }
  db.exec('ALTER TABLE modules DROP COLUMN tier')
}

function renameLegacyOrigins(db: Database.Database): void {
  db.exec(`
    UPDATE modules SET origin = 'aggregate' WHERE origin = 'ai-mega';
    UPDATE modules SET origin = 'split' WHERE origin = 'ai-split';
  `)
}

function addModuleColumns(db: Database.Database): void {
  const cols = (db.pragma('table_info(modules)') as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('key_exports')) db.exec('ALTER TABLE modules ADD COLUMN key_exports TEXT')
  if (!cols.includes('dir_paths')) db.exec('ALTER TABLE modules ADD COLUMN dir_paths TEXT')
  if (!cols.includes('display_name')) db.exec('ALTER TABLE modules ADD COLUMN display_name TEXT')
  if (!cols.includes('description')) db.exec('ALTER TABLE modules ADD COLUMN description TEXT')
  if (!cols.includes('locked')) db.exec('ALTER TABLE modules ADD COLUMN locked INTEGER NOT NULL DEFAULT 0')
}

function rebuildIfOldOriginCheck(db: Database.Database): void {
  const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='modules'").get() as { sql: string } | undefined)?.sql ?? ''
  if (!ddl.includes('CHECK')) return
  db.pragma('foreign_keys = OFF')
  try {
    db.exec(`
      CREATE TABLE modules_new (
        id           INTEGER PRIMARY KEY,
        parent_id    INTEGER REFERENCES modules_new(id),
        name         TEXT NOT NULL,
        display_name TEXT,
        description  TEXT,
        origin       TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        key_exports  TEXT,
        dir_paths    TEXT
      );
      INSERT INTO modules_new (id, parent_id, name, display_name, description, origin, created_at, key_exports, dir_paths)
        SELECT id, parent_id, name, display_name, description, origin, created_at, key_exports, dir_paths FROM modules;
      DROP TABLE modules;
      ALTER TABLE modules_new RENAME TO modules;
    `)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function rebuildFilesIfHasContentHash(db: Database.Database): void {
  const cols = (db.pragma('table_info(files)') as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('content_hash')) return
  db.pragma('foreign_keys = OFF')
  try {
    db.exec(`
      CREATE TABLE files_new (
        path       TEXT PRIMARY KEY,
        module_id  INTEGER REFERENCES modules(id)
      );
      INSERT INTO files_new (path, module_id) SELECT path, module_id FROM files;
      DROP TABLE files;
      ALTER TABLE files_new RENAME TO files;
      CREATE INDEX IF NOT EXISTS idx_files_module ON files(module_id);
    `)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function rebuildEdgesIfHasKindCheck(db: Database.Database): void {
  const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='edges'").get() as { sql: string } | undefined)?.sql ?? ''
  if (!ddl.includes('CHECK')) return
  db.pragma('foreign_keys = OFF')
  try {
    db.exec(`
      DELETE FROM edges WHERE kind <> 'import';
      CREATE TABLE edges_new (
        source_file  TEXT NOT NULL,
        target_file  TEXT NOT NULL,
        kind         TEXT NOT NULL,
        PRIMARY KEY  (source_file, target_file, kind)
      );
      INSERT INTO edges_new (source_file, target_file, kind) SELECT source_file, target_file, kind FROM edges;
      DROP TABLE edges;
      ALTER TABLE edges_new RENAME TO edges;
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_file);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_file);
    `)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
