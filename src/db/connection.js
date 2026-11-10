const fs = require('node:fs');
const path = require('node:path');

async function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  let sqlite;
  try { sqlite = require('node:sqlite'); } catch { /* Node 20 keeps the existing sqlite3 adapter. */ }
  if (sqlite) {
    const native = new sqlite.DatabaseSync(filename);
    native.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    return {
      all: async (sql, params = []) => native.prepare(sql).all(...params),
      get: async (sql, params = []) => native.prepare(sql).get(...params),
      run: async (sql, params = []) => { const result = native.prepare(sql).run(...params); return { changes: result.changes, lastID: result.lastInsertRowid }; },
      exec: async sql => native.exec(sql), close: async () => native.close(),
    };
  }
  const { open } = require('sqlite');
  const db = await open({ filename, driver: require('sqlite3').Database });
  await db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}
module.exports = { openDatabase };
