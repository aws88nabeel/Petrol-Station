import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createSqliteAdapter({ dbPath } = {}) {
  const DB_PATH = dbPath || process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'erp.db');
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  const handle = new DatabaseSync(DB_PATH);
  // DELETE journal mode: no -wal/-shm sidecar files, so a crashed/killed process
  // can never leave a stale lock that blocks the next write (a classic Windows hang).
  handle.exec('PRAGMA journal_mode = DELETE');
  handle.exec('PRAGMA busy_timeout = 8000');
  handle.exec('PRAGMA foreign_keys = ON');

  function norm(v) {
    return v === undefined ? null : v;
  }

  return {
    isMysql: false,
    name: 'sqlite',

    query(sql, params = []) {
      return handle.prepare(sql).all(...params.map(norm));
    },
    get(sql, params = []) {
      return handle.prepare(sql).get(...params.map(norm)) || null;
    },
    run(sql, params = []) {
      const info = handle.prepare(sql).run(...params.map(norm));
      return { insertId: Number(info.lastInsertRowid), changes: info.changes };
    },
    runScript(sql) {
      handle.exec(sql);
    },

    // Inside a transaction the same global handle is reused, so `t` === this.
    async session(fn) {
      handle.exec('BEGIN');
      try {
        const result = await fn(this);
        handle.exec('COMMIT');
        return result;
      } catch (e) {
        handle.exec('ROLLBACK');
        throw e;
      }
    },

    close() {
      try { handle.close(); } catch { /* already closed */ }
    },
  };
}