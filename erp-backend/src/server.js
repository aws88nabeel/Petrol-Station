import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { dbNowStr } from './db.js';
import { authenticate, requireRole, requireRoleOrAbove, signToken } from './auth.js';
import service from './services.js';
import { exportCSV } from './export.js';
import { invoicePDF, summaryPDF, stockLedgerPDF, stockEntriesPDF } from './pdf.js';
import { rateLimit, securityHeaders, corsGuard } from './security.js';
import gzipResponse from './gzip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');

// Security headers first, then CORS (same-origin SPA needs none), then a
// generous global limiter, a bounded JSON body, and gzip for chunky payloads.
app.use(securityHeaders);
const corsOrigins = new Set(
  (process.env.CORS_ORIGIN || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
);
if (process.env.NODE_ENV !== 'production') {
  corsOrigins.add('http://localhost:5173');
  corsOrigins.add('http://127.0.0.1:5173');
  corsOrigins.add('http://localhost:4000');
  corsOrigins.add('http://127.0.0.1:4000');
}
app.use(corsGuard(corsOrigins));
app.use(rateLimit({ windowMs: 60000, max: 600, key: (req) => req.ip }));
app.use(express.json({ limit: '256kb' }));
app.use(gzipResponse());

// Express 4 does not await rejected promises from async handlers/wrappers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Auth ----------
// Brute-force protection: per-IP+username window of 10 attempts / 15 min.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `${req.ip}:${String(req.body && req.body.username || '').toLowerCase()}` });

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || username.length > 64) {
    return res.status(400).json({ error: 'Username is required' });
  }
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !(await bcrypt.compare(String(password || ''), user.password))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (!user.is_active) return res.status(403).json({ error: 'Account disabled' });
  const token = signToken(user);
  res.json({
    token,
    user: {
      user_id: user.user_id, username: user.username, full_name: user.full_name,
      role: user.role, must_change_password: !!user.must_change_password,
    },
  });
}));

// Forced password change. Allows the acting user to change their own password;
// an ADMIN may also force-change any other user by supplying a target user_id.
// Inputs are validated (length/type) before any DB write.
const cap = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v);
app.post('/api/auth/change-password', authenticate, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const targetUserId = cap(req.body.targetUserId, 64);
  const actingId = Number(req.user.user_id);
  const isAdmin = req.user.role === 'ADMIN';
  const subjectId = targetUserId && String(targetUserId) !== String(actingId) ? Number(targetUserId) : actingId;
  if (!newPassword || String(newPassword).length < 8 || String(newPassword).length > 128) {
    return res.status(400).json({ error: 'New password must be 8–128 characters' });
  }
  if (isAdmin && targetUserId && subjectId !== actingId) {
    // Admin reset: requires ONLY a newPassword (admin knows who they are).
  } else {
    const user = await db.get('SELECT * FROM users WHERE user_id = ?', [actingId]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!(await bcrypt.compare(String(currentPassword || ''), user.password))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    if (await bcrypt.compare(String(newPassword), user.password)) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }
  }
  const hash = await bcrypt.hash(String(newPassword), 10);
  await db.run("UPDATE users SET password = ?, must_change_password = 0 WHERE user_id = ?", [hash, subjectId]);
  await service.auditEntry(db, actingId, 'CHANGE_PASSWORD', 'users', subjectId, null, { user_id: subjectId });
  res.json({ ok: true });
}));

// ---------- Catalog ----------
app.get('/api/catalog', authenticate, wrap(async (req, res) => res.json(await service.getCatalog())));

// ---------- Profit rules ----------
app.get('/api/profit-rules', authenticate, wrap(async (req, res) => res.json(await service.listProfitRules())));
app.post('/api/profit-rules', authenticate, requireRoleOrAbove('ADMIN'), wrap(async (req, res) => {
  const { product_id, method_id, default_profit_baisa, is_active, reason } = req.body;
  const created = await service.createProfitRule(
    { productId: product_id, methodId: method_id, defaultProfitBaisa: default_profit_baisa, isActive: is_active },
    reason, req.user.user_id
  );
  res.status(201).json(created);
}));
app.put('/api/profit-rules/:id', authenticate, requireRoleOrAbove('ADMIN'), wrap(async (req, res) => {
  const { default_profit_baisa, is_active, reason } = req.body;
  const updated = await service.updateProfitRule(
    Number(req.params.id),
    { defaultProfitBaisa: default_profit_baisa, isActive: is_active },
    reason, req.user.user_id
  );
  res.json(updated);
}));
app.delete('/api/profit-rules/:id', authenticate, requireRoleOrAbove('ADMIN'), wrap(async (req, res) => {
  res.json(await service.deleteProfitRule(Number(req.params.id), req.body?.reason, req.user.user_id));
}));
app.get('/api/audit/override', authenticate, requireRoleOrAbove('MANAGER'), wrap(async (req, res) => {
  const { fromDate, toDate } = req.query;
  res.json(await service.overrideAudit({
    fromDate: fromDate || '1970-01-01', toDate: toDate || '2999-12-31', limit: req.query.limit,
  }));
}));

// ---------- Sales ----------
app.post('/api/sales', authenticate, requireRoleOrAbove('CASHIER'), wrap(async (req, res) => {
  const sale = await service.createSale(req.body, req.user.user_id);
  res.status(201).json(sale);
}));

app.get('/api/sales', authenticate, wrap(async (req, res) => {
  res.json(await service.listSales({ ...req.query }));
}));

app.get('/api/sales/:id', authenticate, wrap(async (req, res) => {
  const sale = await service.getSale(Number(req.params.id));
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  res.json(sale);
}));

app.post('/api/sales/:id/void', authenticate, requireRoleOrAbove('MANAGER'), wrap(async (req, res) => {
  const sale = await service.voidSale(Number(req.params.id), req.user.user_id, req.body.reason);
  res.json(sale);
}));

// ---------- Stock ----------
app.get('/api/stock/balance', authenticate, wrap(async (req, res) => res.json(await service.listStockBalances())));
app.get('/api/stock/valuation', authenticate, wrap(async (req, res) => res.json(await service.stockValuation())));
app.get('/api/stock/ledger', authenticate, wrap(async (req, res) => res.json(await service.stockLedger({ ...req.query }))));
app.post('/api/stock/receipt', authenticate, requireRoleOrAbove('MANAGER'), wrap(async (req, res) => {
  res.json(await service.stockReceipt(req.body, req.user.user_id));
}));
// manually set the current balance for a product
app.post('/api/stock/balance', authenticate, requireRoleOrAbove('MANAGER'), wrap(async (req, res) => {
  res.json(await service.setStockBalance(req.body, req.user.user_id));
}));

// ---------- Reports ----------
app.get('/api/reports/daily', authenticate, wrap(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(await service.dailyReport(date));
}));
app.get('/api/reports/profit', authenticate, wrap(async (req, res) => {
  const { fromDate, toDate } = req.query;
  res.json(await service.profitReport({ fromDate: fromDate || '1970-01-01', toDate: toDate || '2999-12-31' }));
}));
app.get('/api/reports/summary', authenticate, wrap(async (req, res) => {
  const f = req.query.fromDate || '1970-01-01';
  const t = req.query.toDate || f;
  res.json(await service.summaryByMethod({ fromDate: f, toDate: t }));
}));
app.get('/api/reports/stock-ledger', authenticate, wrap(async (req, res) => {
  res.json(await service.stockLedgerReport({ fromDate: req.query.fromDate, toDate: req.query.toDate }));
}));
app.get('/api/reports/stock-entries', authenticate, wrap(async (req, res) => {
  res.json(await service.stockEntriesReport({ fromDate: req.query.fromDate, toDate: req.query.toDate }));
}));
app.get('/api/reports/vat-statement', authenticate, wrap(async (req, res) => {
  res.json(await service.vatStatement({ fromDate: req.query.fromDate, toDate: req.query.toDate }));
}));

// ---------- Exports ----------
app.get('/api/export/csv/:kind', authenticate, wrap(async (req, res) => {
  const { kind } = req.params;
  const { fromDate, toDate, date } = req.query;
  let rows = [];
  if (kind === 'sales') rows = await service.listSales({ fromDate, toDate });
  else if (kind === 'profit') rows = await service.profitReport({ fromDate: fromDate || '1970-01-01', toDate: toDate || '2999-12-31' });
  else if (kind === 'profit-summary') rows = await service.summaryByMethod({ fromDate: fromDate || '1970-01-01', toDate: toDate || '2999-12-31' });
  else if (kind === 'stock-balance') rows = await service.listStockBalances();
  else if (kind === 'stock-valuation') rows = [].concat((await service.stockValuation()).items);
  else if (kind === 'stock-ledger') rows = await service.stockLedgerReport({ fromDate, toDate });
  else if (kind === 'stock-entries') rows = (await service.stockEntriesReport({ fromDate, toDate })).items;
  else if (kind === 'daily') rows = (await service.dailyReport(date || new Date().toISOString().slice(0, 10))).byPaymentMethod;
  else return res.status(400).json({ error: 'Unknown export kind' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
  res.send(exportCSV(rows));
}));

// ---------- PDF exports (Oman-style) ----------
// Summary report (sales + profit by payment method & product) for a date range
app.get('/api/export/pdf/report', authenticate, wrap(async (req, res) => {
  const { fromDate, toDate } = req.query;
  const f = fromDate || new Date().toISOString().slice(0, 10);
  const t = toDate || f;
  const [daily, profit] = await Promise.all([
    service.summaryByMethod({ fromDate: f, toDate: t }),
    service.profitReport({ fromDate: f, toDate: t }),
  ]);
  const buf = await summaryPDF({ fromDate: f, toDate: t, daily, profit });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="sales-profit-report-${f}-to-${t}.pdf"`);
  res.send(buf);
}));

// Fiscal-worthy single-sale invoice PDF
app.get('/api/export/pdf/invoice/:saleId', authenticate, wrap(async (req, res) => {
  const sale = await service.getSale(Number(req.params.saleId));
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const buf = await invoicePDF(sale);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${sale.sale_number}.pdf"`);
  res.send(buf);
}));

// Stock movement ledger PDF for a date range
app.get('/api/export/pdf/stock-ledger', authenticate, wrap(async (req, res) => {
  const f = req.query.fromDate;
  const t = req.query.toDate;
  const rows = await service.stockLedgerReport({ fromDate: f, toDate: t });
  const buf = await stockLedgerPDF({ fromDate: f, toDate: t, rows });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="stock-ledger-${f || 'all'}-to-${t || 'all'}.pdf"`);
  res.send(buf);
}));

// Stock entries PDF (receipts/adjustments with 5% VAT separated) for a date range
app.get('/api/export/pdf/stock-entries', authenticate, wrap(async (req, res) => {
  const f = req.query.fromDate;
  const t = req.query.toDate;
  const report = await service.stockEntriesReport({ fromDate: f, toDate: t });
  const buf = await stockEntriesPDF({ fromDate: f, toDate: t, report });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="stock-entries-${f || 'all'}-to-${t || 'all'}.pdf"`);
  res.send(buf);
}));

// ---------- Users / Access ----------
app.get('/api/users', authenticate, requireRole('ADMIN'), wrap(async (req, res) => {
  res.json(await db.query('SELECT user_id, username, full_name, role, is_active, must_change_password FROM users ORDER BY username'));
}));
app.post('/api/users', authenticate, requireRole('ADMIN'), wrap(async (req, res) => {
  const username = cap(req.body.username, 64);
  const full_name = cap(req.body.full_name, 128);
  const { password, role } = req.body;
  if (!username || !full_name || !role) return res.status(400).json({ error: 'username, full_name and role are required' });
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–64 chars (letters, digits, . _ -)' });
  }
  if (password === undefined || String(password).length < 8 || String(password).length > 128) {
    return res.status(400).json({ error: 'Password must be 8–128 characters' });
  }
  const hash = await bcrypt.hash(String(password), 10);
  const info = await db.run(
    'INSERT INTO users (username, password, full_name, role, must_change_password) VALUES (?, ?, ?, ?, 0)',
    [username, hash, full_name, role]);
  res.status(201).json({ user_id: info.insertId, username, full_name, role, must_change_password: 0 });
}));

app.get('/api/audit/log', authenticate, requireRoleOrAbove('MANAGER'), wrap(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  res.json(await db.query('SELECT al.*, u.full_name FROM audit_log al LEFT JOIN users u ON al.user_id = u.user_id ORDER BY al.created_at DESC, al.log_id DESC LIMIT ?', [limit]));
}));

// lightweight health check for the frontend/ops
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: true, time: dbNowStr() });
});

// ---------- Static SPA (production build) ----------
if (fs.existsSync(PUBLIC_DIR)) {
  // Hashed asset files are immutable → cache for a week; index.html is short-lived.
  app.use(express.static(PUBLIC_DIR, {
    index: 'index.html',
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
    },
  }));
  // SPA fallback: any non-API GET that isn't a real file → index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next(createApi404());
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  function createApi404() {
    const e = new Error('Not found');
    e.status = 404;
    e.api = true;
    return e;
  }
}

app.use((err, req, res, next) => {
  if (err && err.api && err.status === 404) return res.status(404).json({ error: 'Not found' });
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Server error'
    : (err.message || 'Server error');
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`ERP backend listening on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Another ERP backend is probably already running.`);
    console.error('Close the other instance (or its terminal window) and start again.\n');
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});