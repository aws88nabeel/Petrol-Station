// DB facade. Selects an adapter by env and initializes the schema + seed data.
// `DB_TYPE=mysql` targets Hostinger MariaDB; anything else uses the built-in
// sqlite adapter (local dev / tests). All callers use the async interface:
//   query(sql, params) -> rows[]
//   get(sql, params)   -> row | null
//   run(sql, params)   -> { insertId, changes }
//   session(async fn)  -> runs fn(conn) inside a transaction
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import bcrypt from 'bcryptjs';
import { createSqliteAdapter } from './db/sqlite.js';
import { createMysqlAdapter } from './db/mysql.js';
import { SCHEMA_SQLITE, MYSQL_DDL, migrateSalesNotes, migrateUsersMustChange, migrateTanks, migrateProductCosts, ensureIndexes, FIXED_UNIT_COSTS } from './db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optional .env support (deployment convenience). Loads erp-backend/.env if
// present; existing environment variables (e.g. Hostinger panel vars) always
// take precedence because loadEnvFile does not overwrite them.
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  try { process.loadEnvFile ? process.loadEnvFile(ENV_FILE) : undefined; }
  catch (e) { console.warn(`[env] could not load ${ENV_FILE}: ${e.message}`); }
}

const DB_TYPE = process.env.DB_TYPE || 'sqlite';
const adapter = DB_TYPE === 'mysql' ? createMysqlAdapter() : createSqliteAdapter();

// User-provided timestamp strings may come in as ISO (2026-04-07T12:00:00.000Z);
// MariaDB also accepts 'T' but normalize to the engine's native DATETIME format.
function dbNowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function normalizeDateLike(v) {
  if (!v) return null;
  if (typeof v !== 'string') return v;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : v.slice(0, 10);
}

// ---------- Seeding ----------

function seedBaseline(t) {
  const insertMany = async (table, rows) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
    for (const row of rows) {
      await t.run(sql, cols.map((c) => row[c]));
    }
  };

  const salt = bcrypt.genSaltSync(10);
  const hash = (pw) => bcrypt.hashSync(pw, salt);

  // Use explicit ids so sales_numbers/rules stay deterministic across engines.
  const products = [
    { product_id: 1, product_code: 'DIESEL', product_name: 'DIESEL', default_unit_cost: FIXED_UNIT_COSTS.DIESEL },
    { product_id: 2, product_code: 'MOGAS95', product_name: 'MOGAS 95', default_unit_cost: FIXED_UNIT_COSTS.MOGAS95 },
    { product_id: 3, product_code: 'MOGAS91', product_name: 'MOGAS 91', default_unit_cost: FIXED_UNIT_COSTS.MOGAS91 },
  ];
  // Canonical station tanks (must follow products so the FK is satisfied).
  const tanks = [
    { tank_id: 1, tank_code: 'TK-D', tank_name: 'DIESEL Tank', product_id: 1, capacity_litres: 50000, sort_order: 1 },
    { tank_id: 2, tank_code: 'TK-95A', tank_name: 'MOGAS 95 Tank A', product_id: 2, capacity_litres: 50000, sort_order: 2 },
    { tank_id: 3, tank_code: 'TK-91', tank_name: 'MOGAS 91 Tank', product_id: 3, capacity_litres: 50000, sort_order: 3 },
    { tank_id: 4, tank_code: 'TK-95B', tank_name: 'MOGAS 95 Tank B', product_id: 2, capacity_litres: 50000, sort_order: 4 },
  ];
  const methods = [
    { method_id: 1, method_code: 'CASH', method_name: 'Cash', category: 'CASH' },
    { method_id: 2, method_code: 'VISA', method_name: 'Visa Card', category: 'CARD' },
    { method_id: 3, method_code: 'EJABA+', method_name: 'Ejaba+ Platform', category: 'PLATFORM' },
    { method_id: 4, method_code: 'E-FILL', method_name: 'E-Fill Platform', category: 'PLATFORM' },
    { method_id: 5, method_code: 'BASMA+', method_name: 'Basma+ Card', category: 'PLATFORM' },
    { method_id: 6, method_code: 'BASMA+V', method_name: 'Basma+ Virtual', category: 'PLATFORM' },
    { method_id: 7, method_code: 'NSS', method_name: 'NSS', category: 'PLATFORM' },
    { method_id: 8, method_code: 'CREDIT', method_name: 'Credit Sale', category: 'PLATFORM' },
  ];
  const site = [
    { site_id: 1, site_code: 'SITE-001', site_name: 'Petrol Station', address: '', vat_reg_no: '', tin: '' },
  ];
  const users = [
    { user_id: 1, username: 'admin', password: hash('admin123'), full_name: 'System Administrator', role: 'ADMIN', is_active: 1, must_change_password: 1 },
    { user_id: 2, username: 'manager', password: hash('manager123'), full_name: 'Site Manager', role: 'MANAGER', is_active: 1, must_change_password: 1 },
    { user_id: 3, username: 'cashier', password: hash('cashier123'), full_name: 'Front Cashier', role: 'CASHIER', is_active: 1, must_change_password: 1 },
    { user_id: 4, username: 'viewer', password: hash('viewer123'), full_name: 'Read Only User', role: 'VIEWER', is_active: 1, must_change_password: 1 },
  ];

  // Profit rules are fully dynamic and station-configurable by admins.
  // A fresh install starts with no rules; configure them per setup before sales.
  const rules = [];
  // Per-tank opening balances:
  // DIESEL -> TK1, MOGAS 95 -> TK2 + TK4, MOGAS 91 -> TK3.
  const balances = [
    { site_id: 1, product_id: 1, tank_id: 1, balance_litres: 0 },
    { site_id: 1, product_id: 2, tank_id: 2, balance_litres: 0 },
    { site_id: 1, product_id: 3, tank_id: 3, balance_litres: 0 },
    { site_id: 1, product_id: 2, tank_id: 4, balance_litres: 0 },
  ];

  // Sequential awaits preserve FK dependencies (site before stock, methods before rules).
  return insertMany('products', products)
    .then(() => insertMany('tanks', tanks))
    .then(() => insertMany('payment_methods', methods))
    .then(() => insertMany('sites', site))
    .then(() => insertMany('users', users))
    .then(() => insertMany('profit_rules', rules))
    .then(() => insertMany('stock_balances', balances));
}

// Import a full dump (from `scripts/dump-sqlite.mjs`) into a fresh database.
// Runs inside a transaction so a partial import cannot leave a broken DB.
async function importBootstrap(t, data) {
  const order = ['products', 'payment_methods', 'sites', 'users', 'tanks', 'stock_balances',
    'profit_rules', 'profit_rule_audit', 'stock_movements', 'sales', 'sale_lines',
    'sale_profit_audit', 'audit_log'];
  for (const table of order) {
    const rows = data[table];
    if (!rows || !rows.length) continue;
    // Canonical tanks are always seeded by migrateTanks first, so the dump copy
    // is redundant for a fresh MySQL import.
    if (table === 'tanks') {
      const existing = await t.get('SELECT COUNT(*) AS c FROM tanks');
      if (existing && Number(existing.c) > 0) continue;
    }
    if (table === 'users' && !('must_change_password' in rows[0])) {
      rows.forEach((r) => { r.must_change_password = 1; });
    }
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
    for (const row of rows) {
      await t.run(sql, cols.map((c) => {
        const v = row[c];
        if (typeof v === 'string' && v.includes('T') && (v.match(/:/g) || []).length >= 2) return normalizeDateLike(v);
        return v;
      }));
    }
  }
}

async function seedDatabase() {
  const has = await adapter.get('SELECT COUNT(*) AS c FROM products');
  if (has && Number(has.c) > 0) return 'skipped (data exists)';

  const bootstrapPath = path.join(__dirname, '..', 'data', 'bootstrap.json');
  if (fs.existsSync(bootstrapPath)) {
    let dump;
    try { dump = JSON.parse(fs.readFileSync(bootstrapPath, 'utf8')); } catch (e) {
      throw new Error(`data/bootstrap.json exists but could not be parsed: ${e.message}`);
    }
    await adapter.session((t) => importBootstrap(t, dump));
    return 'bootstrap imported';
  }

  await adapter.session((t) => seedBaseline(t));
  return 'baseline seeded';
}

// ---------- Initialize ----------

async function initialize() {
  if (adapter.isMysql) {
    await adapter.ping();
    for (const stmt of MYSQL_DDL) await adapter.run(stmt);
  } else {
    adapter.runScript(SCHEMA_SQLITE);
  }
  await migrateSalesNotes(adapter);
  await migrateUsersMustChange(adapter);
  await migrateTanks(adapter);
  await migrateProductCosts(adapter);
  await ensureIndexes(adapter);
  const seeded = await seedDatabase();
  if (seeded !== 'skipped (data exists)') console.log(`[db] ${DB_TYPE}: ${seeded}`);
  return seeded;
}

await initialize();

export default adapter;
export { DB_TYPE, normalizeDateLike, dbNowStr };

// Engine-specific SQL fragments used by services (UPDATE timestamp cols etc.).
export const nowSql = adapter.isMysql ? 'NOW()' : "datetime('now')";
export const todaySql = adapter.isMysql ? 'CURDATE()' : "date('now')";