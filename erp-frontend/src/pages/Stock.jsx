import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadCSV, downloadPDF } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PageHeader, Alert, Empty, Stat, money } from '../ui.jsx';

const fmt = (n, d = 3) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const LEDGER_PAGE = 50;

const FUEL = {
  DIESEL: { liquid: '#f0a73d', edge: '#c97e0f' },
  'MOGAS 91': { liquid: '#ff5a5f', edge: '#cf2f37' },
  'MOGAS 95': { liquid: '#2f9be4', edge: '#196fc0' },
};

const TankGauge = React.memo(function TankGauge({ t }) {
  const cap = Number(t.capacity_litres) || 50000;
  const litres = Number(t.balance_litres || 0);
  const pct = cap > 0 ? Math.min(100, Math.max(0, (litres / cap) * 100)) : 0;
  const fuel = FUEL[t.product_name] || FUEL.DIESEL;
  const cls = litres <= 0 ? 'tank-oos' : pct < 20 ? 'tank-warn' : '';
  const fillHeight = litres > 0 ? Math.max(3, Number(pct.toFixed(1))) : 0;
  return (
    <div className="tank-card">
      <div className={`tank ${cls}`} style={{ borderColor: fuel.liquid }}>
        <div
          className="fill"
          style={{
            height: fillHeight + '%',
            background: litres <= 0
              ? '#d7dee9'
              : `linear-gradient(180deg, ${fuel.liquid}, ${fuel.edge})`,
          }}
        />
        <div className="glass" />
      </div>
      <div className="tank-name">{t.tank_name}</div>
      <div className="tank-prod"><span className={`badge ${litres <= 0 ? 'gray' : 'blue'}`}>{t.product_name}</span></div>
      <div className="tank-read">
        <span className="litres" style={{ color: litres <= 0 ? 'var(--muted)' : 'var(--text)' }}>{fmt(litres)} L</span>
        <span className="pct">{pct.toFixed(0)}%</span>
      </div>
      <div className="tank-cap">capacity {fmt(cap, 0)} L</div>
      <div
        className="tank-value"
        style={{ background: litres <= 0 ? 'linear-gradient(180deg, #b9c2cf, #8b95a5)' : `linear-gradient(180deg, ${fuel.liquid}, ${fuel.edge})`, color: '#fff' }}
      >
        <span className="tv-main">OMR {money(t.stock_value)}</span>
        <span className="tv-sub">incl. input VAT {money(t.input_vat)}</span>
      </div>
    </div>
  );
});

export default function Stock() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [balance, setBalance] = useState([]);
  const [valuation, setValuation] = useState({ items: [], total_value: 0, total_litres: 0 });
  const [ledger, setLedger] = useState([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [receipt, setReceipt] = useState({ productId: '', tankId: '', qtyLitres: '', unitCost: '', referenceNo: '', movementDate: '', notes: '' });
  const [adjust, setAdjust] = useState({ productId: '', tankId: '', balanceLitres: '', unitCost: '', referenceNo: '', notes: '' });
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', productId: '' });

  const canManage = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const tanksByProduct = useMemo(() => {
    const map = {};
    for (const b of balance) {
      if (!map[b.product_id]) map[b.product_id] = [];
      map[b.product_id].push(b);
    }
    return map;
  }, [balance]);

  // Selecting a product auto-fills its fixed contract cost into the receipt /
  // adjustment forms (unit cost is a fixed contract value, not free-form).
  const fixedCost = (v) => (v == null ? '' : Number(v).toFixed(6));
  const pickProduct = (list, pid) => {
    const prod = catalog?.products.find((p) => String(p.product_id) === pid);
    return {
      ...list,
      productId: pid,
      tankId: (tanksByProduct[pid] || [])[0] ? String((tanksByProduct[pid] || [])[0].tank_id) : '',
      unitCost: fixedCost(prod?.default_unit_cost),
    };
  };

  const load = async () => {
    try {
      const [cat, bal, val] = await Promise.all([api.catalog(), api.stockBalance(), api.stockValuation()]);
      setCatalog(cat); setBalance(bal); setValuation(val); setError('');
      await loadLedger();
    } catch (e) { setError(e.message); }
  };
  const loadLedger = async (pageNo) => {
    try {
      const params = { page: pageNo || 1, limit: LEDGER_PAGE };
      if (filters.fromDate) params.fromDate = filters.fromDate;
      if (filters.toDate) params.toDate = filters.toDate;
      if (filters.productId) params.productId = filters.productId;
      const res = await api.stockLedger(params);
      setLedger(res.items);
      setLedgerTotal(res.total);
      setLedgerPage(res.page);
    } catch (e) { setError(e.message); }
  };
  const gotoLedger = (p) => {
    if (p >= 1 && p <= Math.max(1, Math.ceil(ledgerTotal / LEDGER_PAGE))) loadLedger(p);
  };
  useEffect(() => { load(); }, []);

  const submitReceipt = async (e) => {
    e.preventDefault();
    if (!receipt.productId || !(Number(receipt.qtyLitres) > 0)) { setError('Select product and enter positive litres'); return; }
    try {
      await api.stockReceipt({
        siteId: 1,
        productId: Number(receipt.productId),
        tankId: receipt.tankId ? Number(receipt.tankId) : null,
        qtyLitres: Number(receipt.qtyLitres),
        unitCost: receipt.unitCost ? Number(receipt.unitCost) : null,
        referenceNo: receipt.referenceNo || null,
        movementDate: receipt.movementDate || new Date().toISOString().slice(0, 10),
        notes: receipt.notes || null,
      });
      setSuccess('Stock receipt recorded.');
      setReceipt({ productId: '', tankId: '', qtyLitres: '', unitCost: '', referenceNo: '', movementDate: '', notes: '' });
      await load();
    } catch (e) { setError(e.message); }
  };

  const saveBalance = async (e) => {
    e.preventDefault();
    if (!adjust.productId || !(Number(adjust.balanceLitres) >= 0)) { setError('Select a product and enter a zero or positive balance.'); return; }
    setError(''); setSuccess('');
    try {
      await api.setStockBalance({
        siteId: 1,
        productId: Number(adjust.productId),
        tankId: adjust.tankId ? Number(adjust.tankId) : null,
        balanceLitres: Number(adjust.balanceLitres),
        unitCost: adjust.unitCost ? Number(adjust.unitCost) : null,
        referenceNo: adjust.referenceNo || null,
        notes: adjust.notes || 'Manual stock entry',
      });
      setSuccess('Current stock updated.');
      setAdjust({ productId: '', tankId: '', balanceLitres: '', unitCost: '', referenceNo: '', notes: '' });
      await load();
    } catch (e) { setError(e.message); }
  };

  const exportLedgerPDF = async () => {
    try {
      const q = new URLSearchParams();
      if (filters.fromDate) q.set('fromDate', filters.fromDate);
      if (filters.toDate) q.set('toDate', filters.toDate);
      await downloadPDF('/export/pdf/stock-ledger' + (q.toString() ? '?' + q.toString() : ''), `stock-ledger-${filters.fromDate || 'all'}-to-${filters.toDate || 'all'}.pdf`);
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <PageHeader title="Stock" sub="Balances, valuation and movement ledger">
        {canManage && <span className="chip" style={{ borderColor: '#bfe8cf', color: '#0d7a3e', background: 'var(--success-soft)' }}>✓ Receipts enabled for your role</span>}
      </PageHeader>
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="grid grid-3">
        <Stat label="Stock value (at cost)" value={`OMR ${money(valuation.total_value)}`} sub={`${fmt(valuation.total_litres, 3)} litres on hand`} tone="green" icon="◫" />
        <Stat label="Fuels in stock" value={valuation.items.filter((x) => x.balance_litres > 0).length || 0} sub="products with stock" tone="blue" icon="▣" />
        <Stat label="Largest holding" value={valuation.items.reduce((a, b) => (b.stock_value > a.stock_value ? b : a), { stock_value: 0, product_name: '—' }).product_name} sub="by value" tone="purple" icon="⬆" />
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Fuel tanks</h3>
          <span className="hint">Fill level vs 50,000 L capacity</span>
        </div>
        <div className="tank-strip mt">
          {balance.map((t) => <TankGauge key={t.tank_id} t={t} />)}
          {!balance.length && <Empty icon="▭" text="No tanks configured." />}
        </div>
      </div>

      <div className="card card-pad mt">
        <div className="spread"><h3 style={{ margin: 0 }}>Valuation breakdown</h3>
          <div className="row"><span className="muted hint">Cost basis = latest receipt/adjustment unit cost (VAT-inclusive; input VAT separated at 5/105)</span>
            <button className="btn secondary sm" onClick={() => downloadCSV('stock-valuation', {})}>CSV</button></div>
        </div>
        <table className="mt">
          <thead><tr><th>Product</th><th className="num">Litres</th><th className="num">Cost / L (OMR)</th><th className="num">Value excl VAT</th><th className="num">Input VAT (5%)</th><th className="num">Stock value incl VAT</th><th style={{ width: 220 }}>Share of value</th></tr></thead>
          <tbody>
            {valuation.items.map((v) => (
              <tr key={v.product_id}>
                <td style={{ fontWeight: 600 }}>{v.product_name}</td>
                <td className="num">{fmt(v.balance_litres, 3)}</td>
                <td className="num">{v.unit_cost !== null ? fmt(v.unit_cost, 6) : <span className="muted">—</span>}</td>
                <td className="num">{money(v.value_excl_vat)}</td>
                <td className="num" style={{ color: '#b45309' }}>{money(v.input_vat)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{money(v.stock_value)}</td>
                <td>
                  {valuation.total_value > 0 && (
                    <div className="row"><div className="bar" style={{ flex: 1, minWidth: 120 }}><div style={{ width: v.share_pct + '%' }} /></div><span className="hint" style={{ marginLeft: 8 }}>{v.share_pct}%</span></div>
                  )}
                  {valuation.total_value === 0 && <span className="muted">—</span>}
                </td>
              </tr>
            ))}
            {!valuation.items.length && <tr><td colSpan={7}><Empty icon="◫" text="No products yet." /></td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700 }}>TOTAL</td>
              <td className="num" style={{ fontWeight: 700 }}>{fmt(valuation.total_litres, 3)}</td>
              <td />
              <td className="num" style={{ fontWeight: 700 }}>{money(valuation.total_excl)}</td>
              <td className="num" style={{ fontWeight: 700, color: '#b45309' }}>{money(valuation.total_vat)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(valuation.total_value)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-2 mt">
        {canManage && (
          <div className="card card-pad">
            <h3 style={{ margin: 0 }}>Record stock receipt</h3>
            <form onSubmit={submitReceipt}>
              <div className="field mt"><label>Product</label>
                <select value={receipt.productId} onChange={(e) => setReceipt(pickProduct(receipt, e.target.value))}>
                  <option value="">— Select —</option>
                  {catalog?.products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
                </select>
              </div>
              {(tanksByProduct[receipt.productId] || []).length > 0 && (
                <div className="field"><label>Tank</label>
                  <select value={receipt.tankId} onChange={(e) => setReceipt({ ...receipt, tankId: e.target.value })}>
                    {(tanksByProduct[receipt.productId] || []).map((t) => <option key={t.tank_id} value={t.tank_id}>{t.tank_name}</option>)}
                  </select>
                </div>
              )}
              <div className="field"><label>Litres</label><input type="number" step="0.001" min="0" value={receipt.qtyLitres} onChange={(e) => setReceipt({ ...receipt, qtyLitres: e.target.value })} /></div>
              <div className="field"><label>Unit cost / L (OMR, fixed)</label><input type="text" value={receipt.unitCost || ''} disabled placeholder="0.000000" /></div>
              <div className="field"><label>Reference no.</label><input value={receipt.referenceNo} onChange={(e) => setReceipt({ ...receipt, referenceNo: e.target.value })} placeholder="e.g. Delivery note / LPO" /></div>
              <div className="field"><label>Movement date</label><input type="date" value={receipt.movementDate} onChange={(e) => setReceipt({ ...receipt, movementDate: e.target.value })} /></div>
              <div className="field"><label>Notes</label><input value={receipt.notes} onChange={(e) => setReceipt({ ...receipt, notes: e.target.value })} /></div>
              <button className="btn">Record receipt</button>
            </form>
          </div>
        )}

        {canManage && (
          <div className="card card-pad">
            <h3 style={{ margin: 0 }}>Manual stock adjustment</h3>
            <p className="hint">Set the on-hand balance directly. Delta is logged to the ledger as an ADJUSTMENT.</p>
            <form onSubmit={saveBalance}>
              <div className="field mt"><label>Product</label>
                <select value={adjust.productId} onChange={(e) => setAdjust(pickProduct(adjust, e.target.value))}>
                  <option value="">— Select —</option>
                  {catalog?.products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
                </select>
              </div>
              {(tanksByProduct[adjust.productId] || []).length > 0 && (
                <div className="field"><label>Tank</label>
                  <select value={adjust.tankId} onChange={(e) => setAdjust({ ...adjust, tankId: e.target.value })}>
                    {(tanksByProduct[adjust.productId] || []).map((t) => <option key={t.tank_id} value={t.tank_id}>{t.tank_name}</option>)}
                  </select>
                </div>
              )}
              <div className="field"><label>New balance (litres)</label><input type="number" step="0.001" min="0" value={adjust.balanceLitres} onChange={(e) => setAdjust({ ...adjust, balanceLitres: e.target.value })} placeholder="e.g. 50000" /></div>
              <div className="field"><label>Unit cost / L (OMR, fixed)</label><input type="text" value={adjust.unitCost || ''} disabled placeholder="0.000000" /></div>
              <div className="field"><label>Reference no. (optional)</label><input value={adjust.referenceNo} onChange={(e) => setAdjust({ ...adjust, referenceNo: e.target.value })} placeholder="e.g. stocktake ref" /></div>
              <div className="field"><label>Notes</label><input value={adjust.notes} onChange={(e) => setAdjust({ ...adjust, notes: e.target.value })} placeholder="e.g. end-of-month stocktake" /></div>
              <button className="btn">Set balance</button>
            </form>
          </div>
        )}
      </div>

      <div className="card card-pad mt">
        <div className="spread"><h3 style={{ margin: 0 }}>Movement ledger</h3>
          <div className="flex" style={{ gap: 8 }}>
            <button className="btn secondary sm" onClick={() => downloadCSV('stock-ledger', filters)}>CSV</button>
            <button className="btn secondary sm" onClick={exportLedgerPDF}>Export PDF</button>
          </div>
        </div>
        <div className="card mt" style={{ border: 'none', boxShadow: 'none', background: '#f8fafd', padding: 12 }}>
          <div className="flex" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={filters.fromDate} onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={filters.toDate} onChange={(e) => setFilters({ ...filters, toDate: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Product</label>
              <select value={filters.productId} onChange={(e) => setFilters({ ...filters, productId: e.target.value })}>
                <option value="">All</option>
                {catalog?.products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
              </select>
            </div>
            <button className="btn sm" style={{ alignSelf: 'end' }} onClick={() => loadLedger(1)}>Apply</button>
            <button className="btn secondary sm" style={{ alignSelf: 'end' }} onClick={() => { setFilters({ fromDate: '', toDate: '', productId: '' }); loadLedger(1); }}>Reset</button>
          </div>
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Date</th><th>Product</th><th>Tank</th><th>Type</th><th className="num">Qty (L)</th><th className="num">Unit cost</th><th>Reference</th><th>Notes</th></tr></thead>
            <tbody>
              {ledger.map((m) => (
                <tr key={m.movement_id}>
                  <td>{m.movement_date}</td>
                  <td>{m.product_name}</td>
                  <td className="muted">{m.tank_name || '—'}</td>
                  <td><span className={`badge ${m.movement_type === 'SALE' ? 'gray' : 'blue'}`}>{m.movement_type}</span></td>
                  <td className="num" style={{ color: m.quantity_litres < 0 ? '#e03e3e' : '#1a9c52', fontWeight: 600 }}>{m.quantity_litres > 0 ? '+' : ''}{fmt(m.quantity_litres)}</td>
                  <td className="num">{m.unit_cost ? fmt(m.unit_cost, 6) : '—'}</td>
                  <td>{m.reference_no || '—'}</td>
                  <td className="muted">{m.notes || ''}</td>
                </tr>
              ))}
              {!ledger.length && <tr><td colSpan={8}><Empty icon="◫" text="No movements yet — receipts and sales will appear here." /></td></tr>}
            </tbody>
          </table>
        </div>
        {ledgerTotal > LEDGER_PAGE && (
          <div className="flex mt" style={{ justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
            <button className="btn secondary sm" disabled={ledgerPage <= 1} onClick={() => gotoLedger(ledgerPage - 1)}>← Prev</button>
            <span className="hint">Page {ledgerPage} of {Math.ceil(ledgerTotal / LEDGER_PAGE)} · {ledgerTotal} movements</span>
            <button className="btn secondary sm" disabled={ledgerPage >= Math.ceil(ledgerTotal / LEDGER_PAGE)} onClick={() => gotoLedger(ledgerPage + 1)}>Next →</button>
          </div>
        )}
      </div>
    </>
  );
}