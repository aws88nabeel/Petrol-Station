// Database schema definitions for both supported engines.
// sqlite: run as one multi-statement script. mysql: one statement per entry.
// Both engines use '?' placeholders; all timestamps are 'YYYY-MM-DD HH:MM:SS'.

const COMMON = `
CREATE TABLE IF NOT EXISTS products (
  product_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT UNIQUE NOT NULL,
  product_name TEXT NOT NULL,
  unit_of_measure TEXT DEFAULT 'LITRE',
  default_unit_cost REAL,
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_methods (
  method_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  method_code  TEXT UNIQUE NOT NULL,
  method_name  TEXT NOT NULL,
  category     TEXT CHECK (category IN ('CASH','CARD','PLATFORM','MOBILE')),
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
  site_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  site_code    TEXT UNIQUE NOT NULL,
  site_name    TEXT NOT NULL,
  address      TEXT,
  vat_reg_no   TEXT,
  tin          TEXT,
  is_active    INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tanks (
  tank_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tank_code      TEXT UNIQUE NOT NULL,
  tank_name      TEXT NOT NULL,
  product_id     INTEGER REFERENCES products(product_id),
  capacity_litres REAL NOT NULL DEFAULT 50000,
  sort_order     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  movement_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER REFERENCES sites(site_id),
  product_id      INTEGER REFERENCES products(product_id),
  tank_id         INTEGER REFERENCES tanks(tank_id),
  movement_type   TEXT CHECK (movement_type IN ('RECEIPT','SALE','ADJUSTMENT','OPENING')),
  quantity_litres REAL NOT NULL,
  unit_cost       REAL,
  reference_no    TEXT,
  movement_date   TEXT NOT NULL,
  notes           TEXT,
  created_by      INTEGER,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_balances (
  balance_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id        INTEGER REFERENCES sites(site_id),
  product_id     INTEGER REFERENCES products(product_id),
  tank_id        INTEGER REFERENCES tanks(tank_id),
  balance_litres REAL NOT NULL DEFAULT 0,
  last_updated   TEXT DEFAULT (datetime('now')),
  UNIQUE(site_id, product_id, tank_id),
  CONSTRAINT positive_balance CHECK (balance_litres >= 0)
);

CREATE TABLE IF NOT EXISTS profit_rules (
  rule_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          INTEGER REFERENCES products(product_id),
  method_id           INTEGER REFERENCES payment_methods(method_id),
  default_profit_baisa REAL NOT NULL,
  is_active           INTEGER DEFAULT 1,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, method_id)
);

CREATE TABLE IF NOT EXISTS profit_rule_audit (
  audit_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id           INTEGER REFERENCES profit_rules(rule_id),
  old_profit_baisa  REAL,
  new_profit_baisa  REAL,
  changed_by        INTEGER,
  changed_at        TEXT DEFAULT (datetime('now')),
  reason            TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  sale_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_number       TEXT UNIQUE NOT NULL,
  site_id           INTEGER REFERENCES sites(site_id),
  sale_date         TEXT NOT NULL,
  sale_datetime     TEXT NOT NULL,
  shift_no          TEXT,
  payment_method_id INTEGER REFERENCES payment_methods(method_id),
  payment_ref       TEXT,
  total_litres      REAL NOT NULL,
  subtotal_excl_vat REAL NOT NULL,
  vat_amount        REAL NOT NULL DEFAULT 0,
  total_incl_vat    REAL NOT NULL,
  discount_amount   REAL DEFAULT 0,
  net_amount        REAL NOT NULL,
  total_profit_omr  REAL DEFAULT 0,
  status            TEXT DEFAULT 'COMPLETED' CHECK (status IN ('DRAFT','COMPLETED','VOIDED','RETURNED')),
  notes             TEXT,
  created_by        INTEGER,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_lines (
  line_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER REFERENCES sales(sale_id),
  product_id        INTEGER REFERENCES products(product_id),
  quantity_litres   REAL NOT NULL,
  unit_price_excl   REAL NOT NULL,
  unit_price_incl   REAL NOT NULL,
  vat_rate          REAL NOT NULL DEFAULT 5.00,
  line_total_excl   REAL NOT NULL,
  line_total_vat    REAL NOT NULL,
  line_total_incl   REAL NOT NULL,
  profit_baisa      REAL NOT NULL,
  profit_override   INTEGER DEFAULT 0,
  profit_override_reason TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_profit_audit (
  audit_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER REFERENCES sales(sale_id),
  line_id           INTEGER REFERENCES sale_lines(line_id),
  rule_id           INTEGER REFERENCES profit_rules(rule_id),
  original_profit   REAL,
  overridden_profit REAL,
  override_reason   TEXT NOT NULL,
  overridden_by     INTEGER,
  overridden_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  user_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT CHECK (role IN ('CASHIER','MANAGER','ADMIN','VIEWER')),
  is_active   INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  log_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(user_id),
  action      TEXT NOT NULL,
  table_name  TEXT,
  record_id   INTEGER,
  old_values  TEXT,
  new_values  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
`;

export const SCHEMA_SQLITE = COMMON;

// MySQL/MariaDB hand-written DDL (AUTO_INCREMENT, DATETIME defaults, TINYINT booleans).
export const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS products (
    product_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_code VARCHAR(64) NOT NULL,
    product_name VARCHAR(128) NOT NULL,
    unit_of_measure VARCHAR(16) DEFAULT 'LITRE',
    default_unit_cost DOUBLE,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_products_code (product_code)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS payment_methods (
    method_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    method_code VARCHAR(64) NOT NULL,
    method_name VARCHAR(64) NOT NULL,
    category VARCHAR(16),
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_methods_code (method_code)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS sites (
    site_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    site_code VARCHAR(64) NOT NULL,
    site_name VARCHAR(128) NOT NULL,
    address VARCHAR(255),
    vat_reg_no VARCHAR(64),
    tin VARCHAR(64),
    is_active TINYINT NOT NULL DEFAULT 1,
    UNIQUE KEY uq_sites_code (site_code)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS tanks (
    tank_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tank_code VARCHAR(64) NOT NULL,
    tank_name VARCHAR(128) NOT NULL,
    product_id INT,
    capacity_litres DOUBLE NOT NULL DEFAULT 50000,
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_tanks_code (tank_code)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS stock_movements (
    movement_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    site_id INT,
    product_id INT,
    tank_id INT,
    movement_type VARCHAR(16),
    quantity_litres DOUBLE NOT NULL,
    unit_cost DOUBLE,
    reference_no VARCHAR(128),
    movement_date DATE NOT NULL,
    notes VARCHAR(512),
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_sm_product (product_id),
    KEY idx_sm_date (movement_date)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS stock_balances (
    balance_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    product_id INT NOT NULL,
    tank_id INT NOT NULL DEFAULT 1,
    balance_litres DOUBLE NOT NULL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_balance (site_id, product_id, tank_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS profit_rules (
    rule_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    method_id INT NOT NULL,
    default_profit_baisa DOUBLE NOT NULL,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_rule (product_id, method_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS profit_rule_audit (
    audit_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rule_id INT,
    old_profit_baisa DOUBLE,
    new_profit_baisa DOUBLE,
    changed_by INT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason VARCHAR(512)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS sales (
    sale_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sale_number VARCHAR(64) NOT NULL,
    site_id INT,
    sale_date DATE NOT NULL,
    sale_datetime DATETIME NOT NULL,
    shift_no VARCHAR(16),
    payment_method_id INT,
    payment_ref VARCHAR(128),
    total_litres DOUBLE NOT NULL,
    subtotal_excl_vat DOUBLE NOT NULL,
    vat_amount DOUBLE NOT NULL DEFAULT 0,
    total_incl_vat DOUBLE NOT NULL,
    discount_amount DOUBLE DEFAULT 0,
    net_amount DOUBLE NOT NULL,
    total_profit_omr DOUBLE DEFAULT 0,
    status VARCHAR(16) DEFAULT 'COMPLETED',
    notes VARCHAR(512),
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sales_number (sale_number),
    KEY idx_sales_date (sale_date),
    KEY idx_sales_method (payment_method_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS sale_lines (
    line_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity_litres DOUBLE NOT NULL,
    unit_price_excl DOUBLE NOT NULL,
    unit_price_incl DOUBLE NOT NULL,
    vat_rate DOUBLE NOT NULL DEFAULT 5.00,
    line_total_excl DOUBLE NOT NULL,
    line_total_vat DOUBLE NOT NULL,
    line_total_incl DOUBLE NOT NULL,
    profit_baisa DOUBLE NOT NULL,
    profit_override TINYINT NOT NULL DEFAULT 0,
    profit_override_reason VARCHAR(512),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_lines_sale (sale_id),
    KEY idx_lines_product (product_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS sale_profit_audit (
    audit_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sale_id INT,
    line_id INT,
    rule_id INT,
    original_profit DOUBLE,
    overridden_profit DOUBLE,
    override_reason VARCHAR(512) NOT NULL,
    overridden_by INT,
    overridden_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS users (
    user_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    role VARCHAR(16),
    is_active TINYINT NOT NULL DEFAULT 1,
    must_change_password TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_username (username)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    log_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(64) NOT NULL,
    table_name VARCHAR(64),
    record_id INT,
    old_values TEXT,
    new_values TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_user (user_id)
  ) ENGINE=InnoDB`,
];

// Secondary indexes that speed up the list/report queries in both engines.
// Ensured idempotently on every startup (MySQL: information_schema, sqlite:
// PRAGMA index_list). Indexes that already exist via MYSQL_DDL are skipped.
const INDEXES = [
  ['idx_sales_datetime', 'sales', ['sale_datetime']],
  ['idx_sales_date', 'sales', ['sale_date']],
  ['idx_sales_method', 'sales', ['payment_method_id']],
  ['idx_sm_product', 'stock_movements', ['product_id']],
  ['idx_sm_tank', 'stock_movements', ['tank_id']],
  ['idx_sm_date', 'stock_movements', ['movement_date']],
  ['idx_lines_sale', 'sale_lines', ['sale_id']],
  ['idx_lines_product', 'sale_lines', ['product_id']],
  ['idx_audit_user', 'audit_log', ['user_id']],
  ['idx_audit_created', 'audit_log', ['created_at']],
  ['idx_spa_sale', 'sale_profit_audit', ['sale_id']],
  ['idx_spa_overridden', 'sale_profit_audit', ['overridden_at']],
];

export async function ensureIndexes(adapter) {
  for (const [name, table, cols] of INDEXES) {
    let exists;
    if (adapter.isMysql) {
      const row = await adapter.get(
        `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, name]);
      exists = row && Number(row.c) > 0;
    } else {
      const list = await adapter.query(`PRAGMA index_list(${table})`);
      exists = list.some((i) => i.name === name);
    }
    if (!exists) {
      try {
        await adapter.run(`CREATE INDEX ${name} ON ${table} (${cols.join(', ')})`);
        console.log(`[db] created index ${name}`);
      } catch (e) {
        console.warn(`[db] could not create index ${name}: ${e.message}`);
      }
    }
  }
}

// Migrations (column additions for DBs created before a column existed).
export async function migrateSalesNotes(adapter) {
  if (adapter.isMysql) {
    const found = await adapter.get(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales' AND COLUMN_NAME = 'notes'`);
    if (!found || found.c === 0) {
      await adapter.run('ALTER TABLE sales ADD COLUMN notes VARCHAR(512)');
    }
  } else {
    const cols = await adapter.query('PRAGMA table_info(sales)');
    if (!cols.some((c) => c.name === 'notes')) {
      await adapter.run('ALTER TABLE sales ADD COLUMN notes TEXT');
    }
  }
}

// Pre-existing users are forced to set a new password on next login. New rows
// created during migration receive must_change_password = 1 (matches baseline).
export async function migrateUsersMustChange(adapter) {
  if (adapter.isMysql) {
    const found = await adapter.get(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_change_password'`);
    if (!found || found.c === 0) {
      await adapter.run('ALTER TABLE users ADD COLUMN must_change_password TINYINT NOT NULL DEFAULT 1');
    }
  } else {
    const cols = await adapter.query('PRAGMA table_info(users)');
    if (!cols.some((c) => c.name === 'must_change_password')) {
      await adapter.run("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1");
    }
  }
}

// Canonical station tanks. Each product owns 1..N tanks; MOGAS 95 uses two so a
// sale deducts across its tanks in tank_id order.
const TANKS = [
  { tank_id: 1, tank_code: 'TK-D', tank_name: 'DIESEL Tank', product_id: 1, capacity_litres: 50000, sort_order: 1 },
  { tank_id: 2, tank_code: 'TK-95A', tank_name: 'MOGAS 95 Tank A', product_id: 2, capacity_litres: 50000, sort_order: 2 },
  { tank_id: 3, tank_code: 'TK-91', tank_name: 'MOGAS 91 Tank', product_id: 3, capacity_litres: 50000, sort_order: 3 },
  { tank_id: 4, tank_code: 'TK-95B', tank_name: 'MOGAS 95 Tank B', product_id: 2, capacity_litres: 50000, sort_order: 4 },
];

// Adds the tanks table + per-tank stock tracking for databases that predate it.
// 1) creates/expands the tables, 2) seeds the canonical tanks if empty,
// 3) maps existing product balances onto the first tank of each product, and
// 4) guarantees every tank of a stocked product has a balance row (the second
//    MOGAS 95 tank starts at 0).
export async function migrateTanks(adapter) {
  if (adapter.isMysql) {
    // stock_balances: previous schema had UNIQUE(site_id, product_id). Recreate
    // the unique key as (site_id, product_id, tank_id) and add the column.
    if ((await adapter.get(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_balances' AND COLUMN_NAME = 'tank_id'`
    ))?.c === 0) {
      await adapter.run('ALTER TABLE stock_balances DROP INDEX uq_balance');
      await adapter.run('ALTER TABLE stock_balances ADD COLUMN tank_id INT');
      await adapter.run('ALTER TABLE stock_balances ADD UNIQUE KEY uq_balance (site_id, product_id, tank_id)');
    }
    if ((await adapter.get(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_movements' AND COLUMN_NAME = 'tank_id'`
    ))?.c === 0) {
      await adapter.run('ALTER TABLE stock_movements ADD COLUMN tank_id INT');
    }
  } else {
    // sqlite: stock_balances predates tank_id -> rebuild with the new unique key.
    const bcols = await adapter.query('PRAGMA table_info(stock_balances)');
    if (!bcols.some((c) => c.name === 'tank_id')) {
      await adapter.runScript(`
        CREATE TABLE stock_balances_new (
          balance_id     INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id        INTEGER NOT NULL,
          product_id     INTEGER NOT NULL,
          tank_id        INTEGER,
          balance_litres REAL NOT NULL DEFAULT 0,
          last_updated   TEXT DEFAULT (datetime('now')),
          UNIQUE(site_id, product_id, tank_id),
          CONSTRAINT positive_balance CHECK (balance_litres >= 0)
        );
        INSERT INTO stock_balances_new (balance_id, site_id, product_id, balance_litres, last_updated)
          SELECT balance_id, site_id, product_id, balance_litres, last_updated FROM stock_balances;
        DROP TABLE stock_balances;
        ALTER TABLE stock_balances_new RENAME TO stock_balances;
      `);
    }
    const mcols = await adapter.query('PRAGMA table_info(stock_movements)');
    if (!mcols.some((c) => c.name === 'tank_id')) {
      await adapter.run('ALTER TABLE stock_movements ADD COLUMN tank_id INTEGER');
    }
  }

  // Seed the canonical tanks (idempotent: only when the table is empty AND the
  // products table already has data, i.e. a migrated DB). Fresh databases get
  // their tanks from the baseline seed / bootstrap import after products exist.
  const count = await adapter.get('SELECT COUNT(*) AS c FROM tanks');
  const hasProducts = await adapter.get('SELECT COUNT(*) AS c FROM products');
  if ((!count || Number(count.c) === 0) && hasProducts && Number(hasProducts.c) > 0) {
    for (const t of TANKS) {
      await adapter.run(
        'INSERT INTO tanks (tank_id, tank_code, tank_name, product_id, capacity_litres, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [t.tank_id, t.tank_code, t.tank_name, t.product_id, t.capacity_litres, t.sort_order]);
    }
  }

  // Map any legacy product-level balance rows onto the first free tank of each
  // product, then backfill zero rows for tanks of stocked products (95-B).
  const tanks = await adapter.query('SELECT tank_id, product_id FROM tanks ORDER BY tank_id');
  const byProduct = {};
  for (const tk of tanks) (byProduct[tk.product_id] ||= []).push(tk.tank_id);

  const unassigned = await adapter.query('SELECT balance_id, site_id, product_id FROM stock_balances WHERE tank_id IS NULL ORDER BY balance_id');
  const usedByProduct = {};
  for (const row of unassigned) {
    const pool = byProduct[row.product_id] || [];
    const chosen = pool.find((id) => !(usedByProduct[row.product_id] || []).includes(id));
    if (chosen === undefined) continue;
    (usedByProduct[row.product_id] ||= []).push(chosen);
    await adapter.run('UPDATE stock_balances SET tank_id = ? WHERE balance_id = ?', [chosen, row.balance_id]);
  }

  const stocked = await adapter.query('SELECT DISTINCT product_id FROM stock_balances');
  for (const p of stocked) {
    for (const tankId of byProduct[p.product_id] || []) {
      const row = await adapter.get('SELECT balance_id FROM stock_balances WHERE tank_id = ? AND site_id = 1', [tankId]);
      if (!row) {
        await adapter.run('INSERT INTO stock_balances (site_id, product_id, tank_id, balance_litres) VALUES (1, ?, ?, 0)',
          [p.product_id, tankId]);
      }
    }
  }
}

// Fixed unit costs (OMR per litre) for stock valuation. The station buys each
// fuel at a contract cost, so a product's default_unit_cost is authoritative
// and auto-fills the receipt / adjustment forms.
export const FIXED_UNIT_COSTS = {
  DIESEL: 0.250650,
  MOGAS95: 0.231650,
  MOGAS91: 0.221650,
};

export async function migrateProductCosts(adapter) {
  if (adapter.isMysql) {
    const found = await adapter.get(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'default_unit_cost'`);
    if (!found || found.c === 0) {
      await adapter.run('ALTER TABLE products ADD COLUMN default_unit_cost DOUBLE AFTER unit_of_measure');
    }
  } else {
    const cols = await adapter.query('PRAGMA table_info(products)');
    if (!cols.some((c) => c.name === 'default_unit_cost')) {
      await adapter.run('ALTER TABLE products ADD COLUMN default_unit_cost REAL');
    }
  }
  for (const [code, cost] of Object.entries(FIXED_UNIT_COSTS)) {
    await adapter.run('UPDATE products SET default_unit_cost = ? WHERE product_code = ?', [cost, code]);
  }
}