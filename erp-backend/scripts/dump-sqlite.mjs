// Dumps the live sqlite database into data/bootstrap.json so a fresh MySQL
// deployment (Hostinger) can import the exact same data (products, methods,
// site, users, rules, balances, movements, sales + audit trail).
//
//   usage:  node scripts/dump-sqlite.mjs              (default: data/erp.db)
//   env:    DB_PATH=... node scripts/dump-sqlite.mjs  (custom source)
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'erp.db');
const OUT = path.join(__dirname, '..', 'data', 'bootstrap.json');

if (!fs.existsSync(SRC)) {
  console.error(`Source DB not found: ${SRC}`);
  process.exit(1);
}

const TABLES = ['products', 'payment_methods', 'sites', 'users', 'tanks', 'stock_balances',
  'profit_rules', 'profit_rule_audit', 'stock_movements', 'sales', 'sale_lines',
  'sale_profit_audit', 'audit_log'];

const conn = new DatabaseSync(SRC, { readOnly: true });
const dump = {};
for (const table of TABLES) {
  dump[table] = conn.prepare(`SELECT * FROM ${table}`).all();
}
conn.close();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
const total = TABLES.reduce((a, t) => a + dump[t].length, 0);
console.log(`Dumped ${total} rows from ${SRC} -> ${OUT}`);