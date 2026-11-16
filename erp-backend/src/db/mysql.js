import mysql from 'mysql2/promise';

// MariaDB/MySQL adapter for Hostinger (+ local Docker). Uses a connection pool
// so transactions grab a dedicated connection. dateStrings keeps DATETIME
// values as 'YYYY-MM-DD HH:MM:SS' strings (matching the sqlite adapter) instead
// of JS Date objects, preserving CSV/PDF output as before.
export function createMysqlAdapter(env = process.env) {
  const host = env.DB_HOST || '127.0.0.1';
  const port = Number(env.DB_PORT || 3306);
  const user = env.DB_USER || 'erp';
  const password = env.DB_PASSWORD || '';
  const database = env.DB_NAME || 'erp';
  const poolSize = Number(env.DB_POOL_SIZE || 10);

  const pool = mysql.createPool({
    host, port, user, password, database,
    waitForConnections: true,
    connectionLimit: poolSize,
    queueLimit: 0,
    dateStrings: true,
    decimalNumbers: true,
    charset: 'utf8mb4',
    connectTimeout: 10000,
  });

  function bindParams(params) {
    // mysql2 throws on undefined — normalise to null like the sqlite adapter.
    return (params || []).map((p) => p === undefined ? null : p);
  }

  return {
    isMysql: true,
    name: 'mysql',

    async ping() {
      const conn = await pool.getConnection();
      try { await conn.ping(); } finally { conn.release(); }
    },

    async query(sql, params = []) {
      const [rows] = await pool.query(sql, bindParams(params));
      return rows.map((r) => r);
    },
    async get(sql, params = []) {
      const [rows] = await pool.query(sql, bindParams(params));
      return rows[0] || null;
    },
    async run(sql, params = []) {
      const [result] = await pool.query(sql, bindParams(params));
      return { insertId: Number(result.insertId), changes: result.affectedRows || 0 };
    },
    runScript(sql) {
      // Multi-statement DDL is handled statement-by-statement by initialize();
      // this single-statement path is kept for parity with the sqlite adapter.
      return pool.query(sql);
    },

    async session(fn) {
      const conn = await pool.getConnection();
      const bound = {
        isMysql: true,
        query: (sql, params = []) => conn.query(sql, bindParams(params)).then(([rows]) => rows),
        get: (sql, params = []) => conn.query(sql, bindParams(params)).then(([rows]) => rows[0] || null),
        run: (sql, params = []) => conn.query(sql, bindParams(params)).then(([result]) => ({
          insertId: Number(result.insertId), changes: result.affectedRows || 0,
        })),
      };
      try {
        await conn.beginTransaction();
        const result = await fn(bound);
        await conn.commit();
        return result;
      } catch (e) {
        try { await conn.rollback(); } catch { /* already rolled back */ }
        throw e;
      } finally {
        conn.release();
      }
    },

    close() {
      return pool.end();
    },
  };
}