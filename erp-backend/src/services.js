import db, { nowSql, todaySql, normalizeDateLike } from './db.js';
import { computeLine, VAT_RATE } from './profit.js';
import { randomUUID } from 'node:crypto';

// All service functions are async and engine-agnostic. Inside transactions use
// the session handle `t` (MySQL needs queries on the same connection); outside
// transactions use the global `db` facade.

// ---------- Audit helper ----------
// Pass the facade bound to the current transaction (`t`) so the audit row lands
// in the same transaction on MySQL, or `db` when no transaction is open.
export function auditEntry(t, userId, action, tableName, recordId, oldValues, newValues) {
  return t.run(
    'INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, tableName, recordId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null]
  );
}

// ---------- Sales ----------

export async function getDefaultProfit(productId, methodId) {
  const row = await db.get(
    'SELECT rule_id, default_profit_baisa FROM profit_rules WHERE product_id = ? AND method_id = ? AND is_active = 1',
    [productId, methodId]);
  return row || null;
}

export async function createSale(input, userId) {
  const { siteId, saleDate, paymentMethodId, paymentRef, shiftNo, lines, notes } = input;
  const saleNumber = input.saleNumber || genSaleNumber();

  // Validate input shape before touching the DB (protects against bad payloads).
  if (!Array.isArray(lines) || !lines.length) throw new Error('Sale must include at least one line');
  if (!Number(siteId)) throw new Error('A valid site is required');
  if (!Number(paymentMethodId)) throw new Error('A valid payment method is required');
  if (shiftNo && String(shiftNo).length > 16) throw new Error('Shift number too long');
  for (const l of lines) {
    const qty = Number(l.qtyLitres);
    const price = Number(l.unitPriceIncl);
    const vat = Number(l.vatRate || VAT_RATE);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1000000) throw new Error('Invalid quantity on a sale line');
    if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid unit price on a sale line');
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) throw new Error('Invalid VAT rate on a sale line');
    if (l.overrideProfit !== null && l.overrideProfit !== undefined && !Number.isFinite(Number(l.overrideProfit))) {
      throw new Error('Invalid profit override on a sale line');
    }
  }
  const cleanNotes = notes ? String(notes).slice(0, 500) : null;
  const cleanRef = paymentRef ? String(paymentRef).slice(0, 128) : null;

  // Resolve profit per line (default vs override). Profit rules are fully
  // dynamic and configured per station; every active product+method used in a
  // sale must have an active rule.
  const method = await db.get('SELECT method_name FROM payment_methods WHERE method_id = ?', [paymentMethodId]);
  const resolved = [];
  for (const l of lines) {
    const rule = await getDefaultProfit(l.productId, paymentMethodId);
    if (!rule) {
      const product = await db.get('SELECT product_name FROM products WHERE product_id = ?', [l.productId]);
      const pName = product ? product.product_name : `product ${l.productId}`;
      const mName = method ? method.method_name : `method ${paymentMethodId}`;
      throw new Error(`No active profit rule configured for ${pName} / ${mName}. Ask an admin to configure profit rules.`);
    }
    const defaultProfitBaisa = rule.default_profit_baisa;
    const overrideProfit = (l.overrideProfit !== null && l.overrideProfit !== undefined) ? l.overrideProfit : null;
    if (overrideProfit !== null && (l.overrideReason === undefined || l.overrideReason === null || String(l.overrideReason).trim() === '')) {
      throw new Error('A reason is required when overriding profit');
    }
    const profitBaisa = overrideProfit !== null ? overrideProfit : defaultProfitBaisa;
    const computed = computeLine(l.qtyLitres, l.unitPriceIncl, profitBaisa, l.vatRate || VAT_RATE);
    resolved.push({
      ...l, ...computed,
      defaultProfitBaisa, overrideProfit, overrideReason: l.overrideReason || null,
      ruleId: rule ? rule.rule_id : null, profitBaisa, overridden: overrideProfit !== null,
    });
  }

  const totals = computeSaleTotals(resolved);
  const saleDatetime = normalizeDateLike(input.saleDatetime || new Date().toISOString());

  const saleId = await db.session(async (t) => {
    // Validate stock for every line (availability is the sum across tanks)
    for (const l of resolved) {
      const bal = await t.get('SELECT COALESCE(SUM(balance_litres), 0) AS total FROM stock_balances WHERE site_id = ? AND product_id = ?',
        [siteId, l.productId]);
      const available = bal ? Number(bal.total) : 0;
      if (available < l.qtyLitres) {
        throw new Error(`Insufficient stock for product ${l.productId}: have ${available}, need ${l.qtyLitres}`);
      }
    }

    const info = await t.run(`
      INSERT INTO sales (sale_number, site_id, sale_date, sale_datetime, shift_no, payment_method_id,
        payment_ref, total_litres, subtotal_excl_vat, vat_amount, total_incl_vat, discount_amount,
        net_amount, total_profit_omr, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
    `, [
      saleNumber, siteId, saleDate, saleDatetime, shiftNo || null, paymentMethodId,
      cleanRef || null, totals.totalLitres, totals.subtotalExclVat, totals.vatAmount,
      totals.totalInclVat, totals.discountAmount || 0, totals.netAmount, totals.totalProfitOmr,
      cleanNotes || null, userId,
    ]);
    const saleId = info.insertId;

    for (const l of resolved) {
      const lineInfo = await t.run(`
        INSERT INTO sale_lines (sale_id, product_id, quantity_litres, unit_price_excl, unit_price_incl,
          vat_rate, line_total_excl, line_total_vat, line_total_incl, profit_baisa, profit_override,
          profit_override_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        saleId, l.productId, l.qtyLitres, l.unitPriceExcl, l.unitPriceIncl,
        l.vatRate || VAT_RATE, l.lineTotalExcl, l.lineVat, l.lineTotalIncl,
        l.profitBaisa, l.overridden ? 1 : 0, l.overrideReason,
      ]);
      const lineId = lineInfo.insertId;

      // Deduct stock across the product's tanks (first non-empty tank first)
      await deductFromTanks(t, siteId, l.productId, l.qtyLitres);

      await t.run(`
        INSERT INTO stock_movements (site_id, product_id, movement_type, quantity_litres, reference_no, movement_date, notes, created_by)
        VALUES (?, ?, 'SALE', ?, ?, ?, ?, ?)
      `, [siteId, l.productId, -l.qtyLitres, saleNumber, saleDate,
        cleanNotes ? `Sale ${saleNumber} — ${cleanNotes}` : `Sale ${saleNumber}`, userId]);

      // Audit override
      if (l.overridden) {
        await t.run(`
          INSERT INTO sale_profit_audit (sale_id, line_id, rule_id, original_profit, overridden_profit, override_reason, overridden_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [saleId, lineId, l.ruleId, l.defaultProfitBaisa, l.profitBaisa, l.overrideReason, userId]);
      }
    }

    await auditEntry(t, userId, 'CREATE_SALE', 'sales', saleId, null, { saleNumber, totals });
    return saleId;
  });

  return getSale(saleId);
}

function computeSaleTotals(resolved) {
  let totalLitres = 0, subtotalExcl = 0, vatAmount = 0, totalIncl = 0, totalProfit = 0;
  for (const l of resolved) {
    totalLitres += l.qtyLitres;
    subtotalExcl += l.lineTotalExcl;
    vatAmount += l.lineVat;
    totalIncl += l.lineTotalIncl;
    totalProfit += l.profitOmr;
  }
  return {
    totalLitres: round(totalLitres),
    subtotalExclVat: round(subtotalExcl),
    vatAmount: round(vatAmount),
    totalInclVat: round(totalIncl),
    totalProfitOmr: round(totalProfit),
    discountAmount: 0,
    netAmount: round(totalIncl),
  };
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// ---------- Tanks ----------

async function primaryTank(t, productId) {
  const list = await t.query('SELECT tank_id FROM tanks WHERE product_id = ? ORDER BY sort_order, tank_id LIMIT 1', [productId]);
  if (!list.length) throw new Error(`No tank configured for product ${productId}`);
  return list[0].tank_id;
}

// Reduces N litres from a product's tanks in tank_id order. Callers must have
// already validated availability (SUM across tanks), so this only runs on tanks
// that hold stock.
async function deductFromTanks(t, siteId, productId, qty) {
  let remaining = qty;
  const tanks = await t.query(`
    SELECT tank_id, balance_litres FROM stock_balances
    WHERE site_id = ? AND product_id = ? AND balance_litres > 0
    ORDER BY tank_id`, [siteId, productId]);
  for (const tk of tanks) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(tk.balance_litres));
    await t.run(`UPDATE stock_balances SET balance_litres = balance_litres - ?, last_updated = ${nowSql}
      WHERE site_id = ? AND product_id = ? AND tank_id = ?`, [take, siteId, productId, tk.tank_id]);
    remaining -= take;
  }
}

export async function getSale(saleId) {
  const sale = await db.get('SELECT * FROM sales WHERE sale_id = ?', [saleId]);
  if (!sale) return null;
  sale.lines = await db.query('SELECT * FROM sale_lines WHERE sale_id = ?', [saleId]);
  const method = await db.get('SELECT method_name FROM payment_methods WHERE method_id = ?', [sale.payment_method_id]);
  sale.method_name = method ? method.method_name : '';
  const pm = await db.query('SELECT product_id, product_name FROM products');
  sale.productMap = Object.fromEntries(pm.map((p) => [p.product_id, p.product_name]));
  sale.profit_audit = await db.query(`
    SELECT spa.*, u.full_name
    FROM sale_profit_audit spa LEFT JOIN users u ON spa.overridden_by = u.user_id
    WHERE spa.sale_id = ?`, [saleId]);
  return sale;
}

function salesWhere(filters) {
  let sql = ' WHERE 1=1';
  const params = [];
  if (filters.date) { sql += ' AND s.sale_date = ?'; params.push(filters.date); }
  if (filters.fromDate) { sql += ' AND s.sale_date >= ?'; params.push(filters.fromDate); }
  if (filters.toDate) { sql += ' AND s.sale_date <= ?'; params.push(filters.toDate); }
  if (filters.methodId) { sql += ' AND s.payment_method_id = ?'; params.push(filters.methodId); }
  if (filters.status) { sql += ' AND s.status = ?'; params.push(filters.status); }
  return { sql, params };
}

// List sales. With no page/limit it returns the full array (used by CSV export).
// When paginated it returns { items, total, page, limit, totals } where `totals`
// aggregates the ENTIRE filtered set (not just the current page) so the summary
// chips stay correct whatever page you're on.
export async function listSales(filters = {}) {
  const { sql, params } = salesWhere(filters);
  const page = (filters.page === undefined || filters.page === '') ? null : Math.max(1, Number(filters.page) || 1);
  const limit = (filters.limit === undefined || filters.limit === '') ? null : Math.min(200, Math.max(1, Number(filters.limit) || 25));

  const select = `SELECT s.*, pm.method_name FROM sales s
    LEFT JOIN payment_methods pm ON s.payment_method_id = pm.method_id`;
  if (page === null) {
    return db.query(`${select}${sql} ORDER BY s.sale_datetime DESC`, params);
  }

  const offset = (page - 1) * limit;
  const [totalRow, rows, agg] = await Promise.all([
    db.get(`SELECT COUNT(*) AS c FROM sales s${sql}`, params),
    db.query(`${select}${sql} ORDER BY s.sale_datetime DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
    db.get(`
      SELECT COALESCE(SUM(sl.quantity_litres),0) AS litres,
        COALESCE(SUM(sl.line_total_excl),0) AS excl,
        COALESCE(SUM(sl.line_total_vat),0) AS vat,
        COALESCE(SUM(sl.line_total_incl),0) AS incl,
        COALESCE(SUM(ROUND(sl.quantity_litres * sl.profit_baisa / 1000.0, 4)),0) AS profit
      FROM sales s JOIN sale_lines sl ON s.sale_id = sl.sale_id${sql}`, params),
  ]);
  return {
    items: rows,
    total: Number(totalRow.c),
    page,
    limit,
    totals: {
      litres: round(agg ? Number(agg.litres) : 0),
      excl: round(agg ? Number(agg.excl) : 0),
      vat: round(agg ? Number(agg.vat) : 0),
      incl: round(agg ? Number(agg.incl) : 0),
      profit: round(agg ? Number(agg.profit) : 0),
    },
  };
}

export async function voidSale(saleId, userId, reason) {
  await db.session(async (t) => {
    const sale = await t.get('SELECT * FROM sales WHERE sale_id = ?', [saleId]);
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'VOIDED') throw new Error('Sale already voided');

    // Restore stock back onto the product's primary tank
    const lines = await t.query('SELECT * FROM sale_lines WHERE sale_id = ?', [saleId]);
    for (const l of lines) {
      const tankId = await primaryTank(t, l.product_id);
      await t.run(`UPDATE stock_balances SET balance_litres = balance_litres + ?, last_updated = ${nowSql}
        WHERE site_id = ? AND product_id = ? AND tank_id = ?`,
        [l.quantity_litres, sale.site_id, l.product_id, tankId]);
    }
    await t.run(`UPDATE sales SET status = 'VOIDED', updated_at = ${nowSql} WHERE sale_id = ?`, [saleId]);
    await auditEntry(t, userId, 'VOID_SALE', 'sales', saleId, { status: sale.status }, { status: 'VOIDED', reason });
  });
  return getSale(saleId);
}

let seq = 1;
function genSaleNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  // Random suffix (not a process-local counter) so numbers stay unique across restarts.
  const n = ++seq % 1000;
  return `INV-${stamp}-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}-${String(n).padStart(3,'0')}`;
}

// ---------- Profit rules ----------

export async function listProfitRules() {
  return db.query(`
    SELECT pr.*, p.product_code, p.product_name, pm.method_code, pm.method_name, pm.category AS method_category
    FROM profit_rules pr
    JOIN products p ON pr.product_id = p.product_id
    JOIN payment_methods pm ON pr.method_id = pm.method_id
    ORDER BY p.product_name, pm.method_name
  `);
}

export async function createProfitRule({ productId, methodId, defaultProfitBaisa, isActive = 1 }, reason, userId) {
  if (!Number.isFinite(Number(productId)) || !Number.isFinite(Number(methodId))) throw new Error('Product and payment method are required');
  const profit = Number(defaultProfitBaisa);
  if (!Number.isFinite(profit) || profit < 0 || profit > 1000) throw new Error('Default profit must be a number between 0 and 1000 baisa');
  if (!reason || String(reason).trim() === '') throw new Error('A reason is required to create a profit rule');
  const product = await db.get('SELECT product_id, product_name, is_active FROM products WHERE product_id = ?', [Number(productId)]);
  if (!product) throw new Error('Product not found');
  const method = await db.get('SELECT method_id, method_name, is_active FROM payment_methods WHERE method_id = ?', [Number(methodId)]);
  if (!method) throw new Error('Payment method not found');
  const existing = await db.get('SELECT rule_id FROM profit_rules WHERE product_id = ? AND method_id = ?', [Number(productId), Number(methodId)]);
  if (existing) throw new Error('A profit rule for this product and payment method already exists');
  const active = isActive ? 1 : 0;
  const info = await db.run(
    'INSERT INTO profit_rules (product_id, method_id, default_profit_baisa, is_active) VALUES (?, ?, ?, ?)',
    [Number(productId), Number(methodId), profit, active]
  );
  const ruleId = info.insertId;
  await db.run('INSERT INTO profit_rule_audit (rule_id, old_profit_baisa, new_profit_baisa, changed_by, reason) VALUES (?, ?, ?, ?, ?)',
    [ruleId, null, profit, userId, String(reason).trim()]);
  await auditEntry(db, userId, 'CREATE_PROFIT_RULE', 'profit_rules', ruleId, null,
    { product_id: Number(productId), method_id: Number(methodId), default_profit_baisa: profit, is_active: active, reason: String(reason).trim() });
  return db.get(`
    SELECT pr.*, p.product_code, p.product_name, pm.method_code, pm.method_name, pm.category AS method_category
    FROM profit_rules pr JOIN products p ON pr.product_id = p.product_id JOIN payment_methods pm ON pr.method_id = pm.method_id
    WHERE pr.rule_id = ?`, [ruleId]);
}

export async function updateProfitRule(ruleId, { defaultProfitBaisa, isActive }, reason, userId) {
  const rule = await db.get('SELECT * FROM profit_rules WHERE rule_id = ?', [ruleId]);
  if (!rule) throw new Error('Rule not found');
  if (!reason || String(reason).trim() === '') throw new Error('A reason is required to change a profit rule');
  const newProfit = defaultProfitBaisa === undefined || defaultProfitBaisa === null ? rule.default_profit_baisa : Number(defaultProfitBaisa);
  if (!Number.isFinite(newProfit) || newProfit < 0 || newProfit > 1000) throw new Error('Default profit must be a number between 0 and 1000 baisa');
  const newActive = isActive === undefined || isActive === null ? rule.is_active : (isActive ? 1 : 0);
  if (newProfit === Number(rule.default_profit_baisa) && newActive === Number(rule.is_active)) {
    throw new Error('No changes to save');
  }
  await db.run(`UPDATE profit_rules SET default_profit_baisa = ?, is_active = ?, updated_at = ${nowSql} WHERE rule_id = ?`,
    [newProfit, newActive, ruleId]);
  await db.run('INSERT INTO profit_rule_audit (rule_id, old_profit_baisa, new_profit_baisa, changed_by, reason) VALUES (?, ?, ?, ?, ?)',
    [ruleId, rule.default_profit_baisa, newProfit, userId, String(reason).trim()]);
  await auditEntry(db, userId, 'UPDATE_PROFIT_RULE', 'profit_rules', ruleId,
    { default_profit_baisa: rule.default_profit_baisa, is_active: rule.is_active },
    { default_profit_baisa: newProfit, is_active: newActive, reason: String(reason).trim() });
  return db.get(`
    SELECT pr.*, p.product_code, p.product_name, pm.method_code, pm.method_name, pm.category AS method_category
    FROM profit_rules pr JOIN products p ON pr.product_id = p.product_id JOIN payment_methods pm ON pr.method_id = pm.method_id
    WHERE pr.rule_id = ?`, [ruleId]);
}

export async function deleteProfitRule(ruleId, reason, userId) {
  const rule = await db.get(`
    SELECT pr.*, p.product_name, pm.method_name
    FROM profit_rules pr JOIN products p ON pr.product_id = p.product_id JOIN payment_methods pm ON pr.method_id = pm.method_id
    WHERE pr.rule_id = ?`, [ruleId]);
  if (!rule) throw new Error('Rule not found');
  if (!reason || String(reason).trim() === '') throw new Error('A reason is required to remove a profit rule');
  await db.session(async (t) => {
    await auditEntry(t, userId, 'DELETE_PROFIT_RULE', 'profit_rules', ruleId,
      { product_id: rule.product_id, method_id: rule.method_id, default_profit_baisa: rule.default_profit_baisa, is_active: rule.is_active },
      { reason: String(reason).trim(), product_name: rule.product_name, method_name: rule.method_name });
    // Clear dependent config-audit rows so the rule can be removed cleanly;
    // preserve sale-profit audit history by detaching the rule reference.
    await t.run('DELETE FROM profit_rule_audit WHERE rule_id = ?', [ruleId]);
    await t.run('UPDATE sale_profit_audit SET rule_id = NULL WHERE rule_id = ?', [ruleId]);
    await t.run('DELETE FROM profit_rules WHERE rule_id = ?', [ruleId]);
  });
  return { ok: true };
}

// ---------- Stock ----------

export async function listStockBalances() {
  const rows = await db.query(`
    SELECT sb.*, t.tank_code, t.tank_name, t.capacity_litres, t.sort_order,
      p.product_code, p.product_name,
      (SELECT COALESCE(p.default_unit_cost,
        (SELECT sm.unit_cost FROM stock_movements sm
          WHERE sm.product_id = sb.product_id AND sm.tank_id = sb.tank_id
            AND sm.unit_cost IS NOT NULL
          ORDER BY sm.movement_date DESC, sm.movement_id DESC LIMIT 1))) AS unit_cost
    FROM stock_balances sb
    JOIN tanks t ON sb.tank_id = t.tank_id
    JOIN products p ON sb.product_id = p.product_id
    ORDER BY t.sort_order, t.tank_id
  `);
  return rows.map((r) => {
    const cost = r.unit_cost === null || r.unit_cost === undefined ? null : Number(r.unit_cost);
    const incl = round(Number(r.balance_litres) * (cost || 0));
    const excl = round(incl / (1 + VAT_RATE_NUM));
    return {
      ...r,
      unit_cost: cost,
      stock_value: incl,
      value_excl_vat: excl,
      input_vat: round(incl - excl),
    };
  });
}

// Stock valuation in money terms: each product is valued at the most recent
// recorded unit cost (from a RECEIPT or ADJUSTMENT movement that carried a
// cost). The contract cost is VAT-inclusive, so the input VAT paid to the
// supplier is separated at 5/105. Returns per-product share and a grand
// total plus total litres.
export async function stockValuation() {
  const rows = await db.query(`
    SELECT p.product_id, p.product_name,
      (SELECT COALESCE(SUM(sb.balance_litres), 0) FROM stock_balances sb
        WHERE sb.product_id = p.product_id) AS balance_litres,
      COALESCE(p.default_unit_cost,
        (SELECT sm.unit_cost FROM stock_movements sm
          WHERE sm.product_id = p.product_id AND sm.unit_cost IS NOT NULL
          ORDER BY sm.movement_date DESC, sm.movement_id DESC LIMIT 1)) AS unit_cost
    FROM products p
    ORDER BY p.product_name
  `);
  const items = rows.map((r) => {
    const cost = Number(r.unit_cost || 0);
    const incl = round(r.balance_litres * cost);
    const excl = round(incl / (1 + VAT_RATE_NUM));
    return {
      product_id: r.product_id,
      product_name: r.product_name,
      balance_litres: round(r.balance_litres),
      unit_cost: r.unit_cost === null || r.unit_cost === undefined ? null : cost,
      stock_value: incl,
      value_excl_vat: excl,
      input_vat: round(incl - excl),
    };
  });
  const total_value = round(items.reduce((a, x) => a + x.stock_value, 0));
  const total_excl = round(items.reduce((a, x) => a + x.value_excl_vat, 0));
  const total_vat = round(items.reduce((a, x) => a + x.input_vat, 0));
  const total_litres = round(items.reduce((a, x) => a + x.balance_litres, 0));
  for (const x of items) x.share_pct = total_value > 0 ? Math.round((x.stock_value / total_value) * 100) : 0;
  return { items, total_value, total_excl, total_vat, total_litres };
}

// VAT reconciliation for a period: the input VAT paid to suppliers on stock
// (from stock entries) against the output VAT received from customers on sales.
// Net VAT payable = output VAT received - input VAT paid.
export async function vatStatement({ fromDate, toDate } = {}) {
  const f = fromDate || '1970-01-01';
  const t = toDate || '2999-12-31';
  const input = await stockEntriesReport({ fromDate: f, toDate: t });
  const sales = await summaryByMethod({ fromDate: f, toDate: t });
  const output = {
    excl: round(sales.reduce((a, r) => a + Number(r.total_excl || 0), 0)),
    vat: round(sales.reduce((a, r) => a + Number(r.total_vat || 0), 0)),
    incl: round(sales.reduce((a, r) => a + Number(r.total_incl || 0), 0)),
  };
  return {
    from: f,
    to: t,
    input: { excl: input.total_excl, vat: input.total_vat, incl: input.total_incl, litres: input.total_litres },
    output,
    net_vat: round(output.vat - input.total_vat),
  };
}

export async function stockReceipt({ siteId, productId, tankId, qtyLitres, unitCost, referenceNo, movementDate, notes }, userId) {
  const qty = Number(qtyLitres);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1000000) throw new Error('Quantity must be a positive number');
  if (!Number(siteId) || !Number(productId)) throw new Error('Site and product are required');
  if (unitCost != null && !Number.isFinite(Number(unitCost))) throw new Error('Invalid unit cost');
  const cleanRef = referenceNo ? String(referenceNo).slice(0, 128) : null;
  const cleanNotes = notes ? String(notes).slice(0, 500) : null;
  await db.session(async (t) => {
    const targetTank = tankId || await primaryTank(t, productId);
    const bal = await t.get('SELECT balance_id FROM stock_balances WHERE site_id = ? AND product_id = ? AND tank_id = ?',
      [siteId, productId, targetTank]);
    if (!bal) throw new Error(`No balance row for product ${productId}, tank ${targetTank}`);
    await t.run(`UPDATE stock_balances SET balance_litres = balance_litres + ?, last_updated = ${nowSql} WHERE balance_id = ?`,
      [qty, bal.balance_id]);
    await t.run(`INSERT INTO stock_movements (site_id, product_id, tank_id, movement_type, quantity_litres, unit_cost, reference_no, movement_date, notes, created_by)
      VALUES (?, ?, ?, 'RECEIPT', ?, ?, ?, ?, ?, ?)`,
      [siteId, productId, targetTank, qty, unitCost || null, cleanRef, movementDate, cleanNotes, userId]);
    await auditEntry(t, userId, 'STOCK_RECEIPT', 'stock_movements', null, null, { productId, tankId: targetTank, qtyLitres: qty, referenceNo: cleanRef });
  });
  return listStockBalances();
}

// Directly set the current on-hand balance for a product/tank (manual stock
// entry). Replaces the balance with the entered value and logs an ADJUSTMENT
// movement so the ledger reflects the change.
export async function setStockBalance({ siteId, productId, tankId, balanceLitres, unitCost, referenceNo, notes }, userId) {
  const target = Number(balanceLitres);
  if (!Number.isFinite(target) || target < 0 || target > 2000000) throw new Error('Balance must be a number between 0 and 2,000,000');
  if (unitCost != null && !Number.isFinite(Number(unitCost))) throw new Error('Invalid unit cost');
  const cleanRef = referenceNo ? String(referenceNo).slice(0, 128) : null;
  const cleanNotes = notes ? String(notes).slice(0, 500) : null;
  let delta, targetTank;
  await db.session(async (t) => {
    targetTank = tankId || await primaryTank(t, productId);
    let existing = await t.get('SELECT balance_id, balance_litres FROM stock_balances WHERE site_id = ? AND product_id = ? AND tank_id = ?',
      [siteId, productId, targetTank]);
    if (!existing) {
      await t.run('INSERT INTO stock_balances (site_id, product_id, tank_id, balance_litres) VALUES (?, ?, ?, 0)',
        [siteId, productId, targetTank, 0]);
      existing = { balance_id: null, balance_litres: 0 };
    }
    delta = target - existing.balance_litres;
    await t.run(`UPDATE stock_balances SET balance_litres = ?, last_updated = ${nowSql} WHERE site_id = ? AND product_id = ? AND tank_id = ?`,
      [target, siteId, productId, targetTank]);
    await t.run(`INSERT INTO stock_movements (site_id, product_id, tank_id, movement_type, quantity_litres, unit_cost, reference_no, movement_date, notes, created_by)
      VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ${todaySql}, ?, ?)`,
      [siteId, productId, targetTank, delta, unitCost || null, cleanRef, cleanNotes, userId]);
    await auditEntry(t, userId, 'SET_STOCK_BALANCE', 'stock_balances', null,
      { balance_litres: existing.balance_litres }, { balance_litres: target, tank_id: targetTank, delta, referenceNo: cleanRef });
  });
  return listStockBalances();
}

export async function stockLedger(filters = {}) {
  let sql = `FROM stock_movements sm
             JOIN products p ON sm.product_id = p.product_id
             LEFT JOIN tanks t ON sm.tank_id = t.tank_id WHERE 1=1`;
  const params = [];
  if (filters.fromDate) { sql += ' AND sm.movement_date >= ?'; params.push(filters.fromDate); }
  if (filters.toDate) { sql += ' AND sm.movement_date <= ?'; params.push(filters.toDate); }
  if (filters.productId) { sql += ' AND sm.product_id = ?'; params.push(filters.productId); }
  const select = `SELECT sm.*, p.product_code, p.product_name, t.tank_name `;
  const order = ' ORDER BY sm.movement_date DESC, sm.created_at DESC';

  const page = (filters.page === undefined || filters.page === '') ? null : Math.max(1, Number(filters.page) || 1);
  const limit = (filters.limit === undefined || filters.limit === '') ? null : Math.min(200, Math.max(1, Number(filters.limit) || 50));
  if (page === null) return db.query(`${select}${sql}${order}`, params);

  const offset = (page - 1) * limit;
  const [totalRow, rows] = await Promise.all([
    db.get(`SELECT COUNT(*) AS c ${sql}`, params),
    db.query(`${select}${sql}${order} LIMIT ? OFFSET ?`, [...params, limit, offset]),
  ]);
  return { items: rows, total: Number(totalRow.c), page, limit };
}

// ---------- Reports ----------

export async function dailyReport(date) {
  const sales = await db.query(`
    SELECT s.*, pm.method_name FROM sales s
    JOIN payment_methods pm ON s.payment_method_id = pm.method_id
    WHERE s.sale_date = ? AND s.status = 'COMPLETED'`, [date]);
  const agg = await db.query(`
    SELECT pm.method_name, COUNT(DISTINCT s.sale_id) AS sale_count,
      COALESCE(SUM(sl.quantity_litres),0) AS total_litres,
      COALESCE(SUM(sl.line_total_excl),0) AS total_excl,
      COALESCE(SUM(sl.line_total_vat),0) AS total_vat,
      COALESCE(SUM(sl.line_total_incl),0) AS total_incl,
      COALESCE(SUM(ROUND(sl.quantity_litres * sl.profit_baisa / 1000.0, 4)),0) AS total_profit
    FROM sales s
    JOIN sale_lines sl ON s.sale_id = sl.sale_id
    JOIN payment_methods pm ON s.payment_method_id = pm.method_id
    WHERE s.sale_date = ? AND s.status = 'COMPLETED'
    GROUP BY pm.method_name ORDER BY total_incl DESC`, [date]);
  return { date, sales, byPaymentMethod: agg };
}

export async function profitReport({ fromDate, toDate }) {
  return db.query(`
    SELECT p.product_name, pm.method_name,
      SUM(sl.quantity_litres) AS total_litres,
      SUM(ROUND(sl.quantity_litres * sl.profit_baisa / 1000.0, 4)) AS total_profit_omr,
      ROUND(AVG(sl.profit_baisa),3) AS avg_profit_baisa,
      SUM(CASE WHEN sl.profit_override THEN 1 ELSE 0 END) AS override_count,
      COUNT(*) AS line_count
    FROM sale_lines sl
    JOIN products p ON sl.product_id = p.product_id
    JOIN sales s ON sl.sale_id = s.sale_id
    JOIN payment_methods pm ON s.payment_method_id = pm.method_id
    WHERE s.sale_date BETWEEN ? AND ? AND s.status = 'COMPLETED'
    GROUP BY p.product_name, pm.method_name
    ORDER BY p.product_name, total_profit_omr DESC`, [fromDate, toDate]);
}

// Aggregated sales by payment method across a date range (for summary reports/PDF)
export async function summaryByMethod({ fromDate, toDate }) {
  return db.query(`
    SELECT pm.method_name, COUNT(DISTINCT s.sale_id) AS sale_count,
      COALESCE(SUM(sl.quantity_litres),0) AS total_litres,
      COALESCE(SUM(sl.line_total_excl),0) AS total_excl,
      COALESCE(SUM(sl.line_total_vat),0) AS total_vat,
      COALESCE(SUM(sl.line_total_incl),0) AS total_incl,
      COALESCE(SUM(ROUND(sl.quantity_litres * sl.profit_baisa / 1000.0, 4)),0) AS total_profit
    FROM sales s
    JOIN sale_lines sl ON s.sale_id = sl.sale_id
    JOIN payment_methods pm ON s.payment_method_id = pm.method_id
    WHERE s.sale_date BETWEEN ? AND ? AND s.status = 'COMPLETED'
    GROUP BY pm.method_name ORDER BY total_incl DESC`, [fromDate, toDate]);
}

export function stockLedgerReport(filters) {
  return stockLedger(filters);
}

// Stock entry report (receipts and positive adjustments) with the 5% VAT
// component separated out. The fixed contract cost is treated as VAT-inclusive,
// so:  excl = incl / 1.05,  vat = incl - excl  (matching the sales engine).
const VAT_RATE_NUM = VAT_RATE / 100;
export async function stockEntriesReport({ fromDate, toDate } = {}) {
  const params = [];
  let sql = `SELECT sm.movement_date, sm.movement_type, sm.quantity_litres, sm.unit_cost,
      sm.reference_no, sm.notes, p.product_name, t.tank_name
    FROM stock_movements sm
    JOIN products p ON sm.product_id = p.product_id
    LEFT JOIN tanks t ON sm.tank_id = t.tank_id
    WHERE sm.quantity_litres > 0 AND sm.movement_type IN ('RECEIPT','ADJUSTMENT')`;
  if (fromDate) { sql += ' AND sm.movement_date >= ?'; params.push(fromDate); }
  if (toDate) { sql += ' AND sm.movement_date <= ?'; params.push(toDate); }
  sql += ' ORDER BY sm.movement_date, sm.movement_id';

  const rows = await db.query(sql, params);
  const items = rows.map((r) => {
    const incl = round(Number(r.quantity_litres) * Number(r.unit_cost || 0));
    const excl = round(incl / (1 + VAT_RATE_NUM));
    return {
      movement_date: r.movement_date,
      movement_type: r.movement_type,
      product_name: r.product_name,
      tank_name: r.tank_name || null,
      quantity_litres: Number(r.quantity_litres),
      unit_cost: r.unit_cost === null || r.unit_cost === undefined ? null : Number(r.unit_cost),
      amount_excl_vat: excl,
      vat_amount: round(incl - excl),
      amount_incl_vat: incl,
      reference_no: r.reference_no || null,
      notes: r.notes || null,
    };
  });
  const total_litres = round(items.reduce((a, x) => a + x.quantity_litres, 0));
  const total_excl = round(items.reduce((a, x) => a + x.amount_excl_vat, 0));
  const total_vat = round(items.reduce((a, x) => a + x.vat_amount, 0));
  const total_incl = round(items.reduce((a, x) => a + x.amount_incl_vat, 0));
  return { items, total_litres, total_excl, total_vat, total_incl };
}

export async function overrideAudit({ fromDate, toDate, limit = 500 }) {
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  return db.query(`
    SELECT spa.*, u.full_name AS overridden_by, p.product_name,
      pm.method_name, sl.product_id, s.sale_number
    FROM sale_profit_audit spa
    JOIN sale_lines sl ON spa.line_id = sl.line_id
    JOIN sales s ON spa.sale_id = s.sale_id
    JOIN products p ON sl.product_id = p.product_id
    JOIN payment_methods pm ON s.payment_method_id = pm.method_id
    LEFT JOIN users u ON spa.overridden_by = u.user_id
    WHERE spa.overridden_at BETWEEN ? AND ?
    ORDER BY spa.overridden_at DESC LIMIT ?`, [fromDate, toDate, lim]);
}

export async function getCatalog() {
  const [products, paymentMethods, sites] = await Promise.all([
    db.query('SELECT * FROM products WHERE is_active = 1 ORDER BY product_name'),
    db.query('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY method_name'),
    db.query('SELECT * FROM sites WHERE is_active = 1'),
  ]);
  return { products, paymentMethods, sites };
}

export default {
  createSale, getSale, listSales, voidSale,
  listProfitRules, createProfitRule, updateProfitRule, deleteProfitRule, getDefaultProfit,
  listStockBalances, stockReceipt, setStockBalance, stockLedger, stockValuation,
  dailyReport, profitReport, summaryByMethod, stockLedgerReport, stockEntriesReport,
  vatStatement, overrideAudit,
  getCatalog, auditEntry,
};