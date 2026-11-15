'use strict';
const { DatabaseSync } = require('node:sqlite');
const { CROPS } = require('./crops');

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#30a46c',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    last_frost TEXT,
    first_frost TEXT,
    mode TEXT NOT NULL DEFAULT 'rows',
    snap INTEGER NOT NULL DEFAULT 6,
    notes TEXT NOT NULL DEFAULT '',
    year INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE plan_members (
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
    PRIMARY KEY (plan_id, user_id)
  );
  CREATE TABLE crops (
    id TEXT PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    builtin INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Vegetable',
    family TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '🌱',
    color TEXT NOT NULL DEFAULT '#30a46c',
    spacing REAL NOT NULL,
    row_spacing REAL NOT NULL,
    timing TEXT NOT NULL DEFAULT '{}',
    dtm INTEGER,
    note TEXT NOT NULL DEFAULT '',
    perennial INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    crop_id TEXT,
    x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
    z INTEGER NOT NULL DEFAULT 0,
    props TEXT NOT NULL DEFAULT '{}',
    updated_by INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX items_plan ON items(plan_id);
  `,
  // v2: location on plans + frost-date lookup cache
  `
  ALTER TABLE plans ADD COLUMN zip TEXT;
  ALTER TABLE plans ADD COLUMN zone TEXT;
  ALTER TABLE plans ADD COLUMN place TEXT;
  CREATE TABLE frost_cache (zip TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL);
  `,
  // v3: seed-starting tracker
  `
  CREATE TABLE seeds (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    crop_id TEXT NOT NULL,
    variety TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT 'indoor',
    sow_count INTEGER,
    sown_date TEXT,
    germinated INTEGER,
    transplanted INTEGER,
    source TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX seeds_plan ON seeds(plan_id);
  `,
];

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = ver; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  seedCrops(db);
  return db;
}

// Upsert the built-in library on every start so updates to the image ship new crops.
function seedCrops(db) {
  const up = db.prepare(`INSERT INTO crops (id, owner_id, builtin, name, category, family, icon, color, spacing, row_spacing, timing, dtm, note, perennial)
    VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, family=excluded.family, icon=excluded.icon,
      color=excluded.color, spacing=excluded.spacing, row_spacing=excluded.row_spacing, timing=excluded.timing, dtm=excluded.dtm,
      note=excluded.note, perennial=excluded.perennial WHERE crops.builtin = 1`);
  db.exec('BEGIN');
  for (const c of CROPS) {
    up.run(c.id, c.name, c.category, c.family, c.icon, c.color, c.spacing, c.row,
      JSON.stringify({ indoor: c.indoor, transplant: c.transplant, direct: c.direct }), c.dtm, c.note || '', c.perennial ? 1 : 0);
  }
  db.exec('COMMIT');
}

module.exports = { openDb };
