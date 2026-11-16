import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PageHeader, Loading, Alert } from '../ui.jsx';

const VAT_RATE = 5.0;

export function computeLinePreview(qty, unitPriceIncl, profitBaisa) {
  const lineTotalIncl = Math.round((qty * unitPriceIncl + Number.EPSILON) * 10000) / 10000;
  const lineTotalExcl = Math.round((lineTotalIncl / (1 + VAT_RATE / 100) + Number.EPSILON) * 10000) / 10000;
  const lineVat = Math.round(((lineTotalIncl - lineTotalExcl) + Number.EPSILON) * 10000) / 10000;
  const profitOmr = Math.round(((qty * profitBaisa) / 1000 + Number.EPSILON) * 10000) / 10000;
  return { lineTotalIncl, lineTotalExcl, lineVat, profitOmr };
}

const fmt = (n, d = 6) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

export default function SalesEntry() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [stock, setStock] = useState([]);
  const [rules, setRules] = useState([]);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [shiftNo, setShiftNo] = useState('01');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  function emptyLine() {
    return { productId: '', qtyLitres: '', unitPriceIncl: '', overrideEnabled: false, overrideProfit: '', overrideReason: '' };
  }

  useEffect(() => {
    Promise.all([api.catalog(), api.stockBalance(), api.profitRules()])
      .then(([cat, bal, rl]) => { setCatalog(cat); setStock(bal); setRules(rl); })
      .catch((e) => setError(e.message));
  }, []);

  const canOverride = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const defaultProfitFor = (productId) => {
    if (!paymentMethodId) return null;
    const r = rules.find((x) => x.product_id === Number(productId) && x.method_id === Number(paymentMethodId) && x.is_active);
    return r ? r.default_profit_baisa : null;
  };

  const stockFor = (productId) => {
    const s = stock.find((x) => x.product_id === Number(productId));
    return s ? s.balance_litres : 0;
  };

  const updateLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const preview = useMemo(() => {
    const computed = lines.map((l) => {
      const qty = Number(l.qtyLitres) || 0;
      const price = Number(l.unitPriceIncl) || 0;
      const profit = l.overrideEnabled ? (Number(l.overrideProfit) || 0) : (defaultProfitFor(l.productId) || 0);
      const c = computeLinePreview(qty, price, profit);
      return { ...l, qty, price, profit, ...c };
    });
    const totals = computed.reduce(
      (acc, c) => ({ litres: acc.litres + c.qty, excl: acc.excl + c.lineTotalExcl, vat: acc.vat + c.lineVat, incl: acc.incl + c.lineTotalIncl, prof: acc.prof + c.profitOmr }),
      { litres: 0, excl: 0, vat: 0, incl: 0, prof: 0 }
    );
    return { computed, totals };
  }, [lines, paymentMethodId, rules]);

  const validations = useMemo(() => {
    const v = [];
    for (let i = 0; i < preview.computed.length; i++) {
      const c = preview.computed[i];
      if (!c.productId) { v.push(`Line ${i + 1}: select a product`); continue; }
      if (!(c.qty > 0)) { v.push(`Line ${i + 1}: enter a positive quantity`); }
      if (!(c.price > 0)) { v.push(`Line ${i + 1}: enter a valid unit price`); }
      if (c.qty > 0 && stockFor(c.productId) < c.qty) {
        v.push(`Line ${i + 1}: stock shortage — ${fmt0(stockFor(c.productId))} L available, need ${fmt0(c.qty)} L`);
      }
      if (c.overrideEnabled && !(c.profit > 0)) { v.push(`Line ${i + 1}: override profit must be positive`); }
      if (c.overrideEnabled && !c.overrideReason.trim()) { v.push(`Line ${i + 1}: a reason is required for the profit override`); }
    }
    if (!paymentMethodId) v.push('Select a payment method');
    return v;
  }, [preview, paymentMethodId]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(null);
    if (validations.length) { setError(validations.join('. ')); return; }
    setBusy(true);
    try {
      const payload = {
        siteId: 1,
        saleDate,
        paymentMethodId: Number(paymentMethodId),
        paymentRef: paymentRef || null,
        notes: notes || null,
        shiftNo,
        lines: preview.computed.map((c) => ({
          productId: Number(c.productId),
          qtyLitres: c.qty,
          unitPriceIncl: c.price,
          ...(c.overrideEnabled ? { overrideProfit: c.profit, overrideReason: c.overrideReason } : {}),
        })),
      };
      const sale = await api.createSale(payload);
      setSuccess(`Sale ${sale.sale_number} recorded — profit OMR ${fmt(sale.total_profit_omr, 6)}`);
      setLines([emptyLine()]);
      setNotes('');
      const bal = await api.stockBalance();
      setStock(bal);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!catalog) return <Loading text="Loading catalog…" />;

  return (
    <>
      <PageHeader
        title="New Sale Entry"
        sub="Manual entry · stock-checked · profit auto-assigned per payment method"
        actions={<button className="btn secondary sm" onClick={() => { setLines([emptyLine()]); setNotes(''); setError(''); setSuccess(null); }}>↺ Clear entry</button>}
      />
      {success && <Alert tone="success">{success}</Alert>}

      {validations.length > 0 && (
        <Alert tone="warn">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Sale not ready yet</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{validations.map((v, i) => <li key={i}>{v}</li>)}</ul>
        </Alert>
      )}
      {error && !validations.length && <Alert tone="error">{error}</Alert>}

      <form onSubmit={submit}>
        <div className="card card-pad">
          <div className="form-grid">
            <div className="field"><label className="">Sale date <span className="req">*</span></label><input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></div>
            <div className="field"><label>Shift</label><input value={shiftNo} onChange={(e) => setShiftNo(e.target.value)} /></div>
            <div className="field"><label>Payment method <span className="req">*</span></label>
              <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                <option value="">— Select —</option>
                {catalog.paymentMethods.map((m) => (
                  <option key={m.method_id} value={m.method_id}>{m.method_name} {m.category !== 'PLATFORM' ? `(${m.category})` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Payment reference (optional)</label><input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="e.g. RFID Voucher / invoice link" /></div>
            <div className="field"><label>Notes (optional)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. bulk order, credit memo, exception note" /></div>
          </div>
        </div>

        <div className="card card-pad mt">
          <div className="spread">
            <h3 style={{ margin: 0 }}>Sale lines</h3>
            <button type="button" className="btn secondary sm" onClick={addLine}>+ Add line</button>
          </div>
          <div className="table-wrap mt">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Product</th><th className="num">Qty (Litres)</th><th className="num">Unit price (incl VAT)</th>
                  <th className="num">Total (incl)</th><th className="num">Profit (baisa/L)</th><th className="num">Profit (OMR)</th><th className="right"></th>
                </tr>
              </thead>
              <tbody>
                {preview.computed.map((c, idx) => {
                  const avail = stockFor(c.productId);
                  const short = c.qty > 0 && avail < c.qty;
                  return (
                    <tr key={idx} style={short ? { background: '#fff7f7' } : undefined}>
                      <td>{idx + 1}</td>
                      <td>
                        <select value={c.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })}>
                          <option value="">— Product —</option>
                          {catalog.products.map((p) => (
                            <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="num"><input style={{ width: 110, textAlign: 'right' }} value={c.qtyLitres} onChange={(e) => updateLine(idx, { qtyLitres: e.target.value })} placeholder="0" /></td>
                      <td className="num"><input style={{ width: 120, textAlign: 'right' }} value={c.unitPriceIncl} onChange={(e) => updateLine(idx, { unitPriceIncl: e.target.value })} placeholder="0.000000" /></td>
                      <td className="num">{fmt(c.lineTotalIncl)}</td>
                      <td className="num">
                        {c.overrideEnabled ? (
                          <input style={{ width: 80, textAlign: 'right' }} value={c.overrideProfit} onChange={(e) => updateLine(idx, { overrideProfit: e.target.value })} />
                        ) : (
                          <span className={c.profit ? 'cell-strong' : 'muted'}>{c.profit ? c.profit : '—'}</span>
                        )}
                      </td>
                      <td className="num">{fmt(c.profitOmr, 6)}</td>
                      <td>
                        <div className="flex" style={{ justifyContent: 'flex-end' }}>
                          {canOverride && !c.overrideEnabled && <button type="button" className="btn secondary sm" title="Override default profit" onClick={() => updateLine(idx, { overrideEnabled: true })}>⚙ Override</button>}
                          {c.overrideEnabled &&
                            <input style={{ width: 170 }} value={c.overrideReason} placeholder="Reason (required)" onChange={(e) => updateLine(idx, { overrideReason: e.target.value })} />}
                          {c.overrideEnabled && <button type="button" className="icon-btn" title="Cancel override" onClick={() => updateLine(idx, { overrideEnabled: false, overrideProfit: '', overrideReason: '' })}>✕</button>}
                          <button type="button" className="icon-btn" title="Remove line" onClick={() => removeLine(idx)} disabled={lines.length === 1}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.computed.map((c, idx) => {
            const avail = stockFor(c.productId);
            if (!(c.qty > 0 && avail < c.qty)) return null;
            return (
              <Alert key={'s' + idx} tone="error">Line {idx + 1}: insufficient stock for {catalog.products.find((p) => p.product_id === Number(c.productId))?.product_name || `product ${c.productId}`} — {fmt0(avail)} L available.</Alert>
            );
          })}

          <div className="grid grid-2 mt">
            <div className="card" style={{ border: '1px dashed var(--border-strong)', boxShadow: 'none', background: 'var(--surface-2)', padding: 14, borderRadius: 'var(--radius-sm)' }}>
              <div className="hint" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Formula: <b>profit per line = (litres × baisa) ÷ 1000</b></span>
                <span>VAT is 5% (excl = incl ÷ 1.05)</span>
                <span>Stock is reduced automatically when you save.</span>
              </div>
            </div>
            <div className="card" style={{ border: '1px solid #cfe0ff', background: 'var(--primary-soft)', padding: 14, borderRadius: 'var(--radius-sm)' }}>
              <table>
                <tbody>
                  <tr><td className="muted">Litres total</td><td className="num" style={{ fontWeight: 600 }}>{fmt0(preview.totals.litres)} L</td></tr>
                  <tr><td className="muted">Subtotal (excl VAT)</td><td className="num" style={{ fontWeight: 600 }}>OMR {fmt(preview.totals.excl, 6)}</td></tr>
                  <tr><td className="muted">VAT @ {VAT_RATE}%</td><td className="num">OMR {fmt(preview.totals.vat, 6)}</td></tr>
                  <tr><td className="muted">Total (incl VAT)</td><td className="num" style={{ fontWeight: 700, fontSize: 16 }}>OMR {fmt(preview.totals.incl, 6)}</td></tr>
                  <tr><td className="muted">Gross profit</td><td className="num" style={{ fontWeight: 700, color: '#0d7a3e' }}>OMR {fmt(preview.totals.prof, 6)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="mt flex">
          <button className="btn lg" disabled={busy || !!validations.length}>{busy ? 'Recording…' : '✓ Complete sale'}</button>
          {!!validations.length && <span className="hint"><kbd>{validations.length}</kbd> issue{validations.length > 1 ? 's' : ''} to resolve above</span>}
        </div>
      </form>
    </>
  );
}