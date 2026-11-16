import React, { useEffect, useState } from 'react';
import { api, downloadCSV, downloadPDF } from '../api.js';
import { PageHeader, Alert, Empty, fmt } from '../ui.jsx';

export default function StockVatReport() {
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState({ items: [], total_litres: 0, total_excl: 0, total_vat: 0, total_incl: 0 });
  const [error, setError] = useState('');

  const load = (f, t) => api.stockEntriesReport(f, t).then(setEntries);

  useEffect(() => {
    const date = new Date().toISOString().slice(0, 10);
    load(date, date).catch((e) => setError(e.message));
  }, []);

  const run = async () => {
    try {
      if (!fromDate || !toDate) return;
      await load(fromDate, toDate);
      setError('');
    } catch (e) { setError(e.message); }
  };

  const exportPDF = async () => {
    try {
      await downloadPDF(`/export/pdf/stock-entries?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`, `stock-entries-vat-${fromDate}-to-${toDate}.pdf`);
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <PageHeader title="Stock report · VAT split (5%)" sub="Receipts and positive adjustments with VAT separated from stock entry amounts" actions={<button className="btn" onClick={exportPDF}>⬇ Export PDF (VAT)</button>} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="card card-pad">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <button className="btn" onClick={run} style={{ alignSelf: 'end' }}>Run report</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>Unit cost is treated as VAT-inclusive; VAT is separated at 5/105 (e.g. VAT = amount × 5 ÷ 105).</p>
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Stock entries</h3>
          <button className="btn secondary sm" onClick={() => downloadCSV('stock-entries', { fromDate, toDate })}>CSV</button>
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Date</th><th>Product</th><th>Tank</th><th>Type</th><th className="num">Qty (L)</th><th className="num">Unit cost</th><th className="num">Excl VAT</th><th className="num">VAT 5%</th><th className="num">Incl VAT</th></tr></thead>
            <tbody>
              {entries.items.map((r, i) => (
                <tr key={i}>
                  <td>{r.movement_date}</td>
                  <td style={{ fontWeight: 600 }}>{r.product_name}</td>
                  <td>{r.tank_name || '—'}</td>
                  <td>{r.movement_type}</td>
                  <td className="num">{fmt(r.quantity_litres, 3)}</td>
                  <td className="num">{r.unit_cost != null ? fmt(r.unit_cost) : '—'}</td>
                  <td className="num">{fmt(r.amount_excl_vat)}</td>
                  <td className="num">{fmt(r.vat_amount)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmt(r.amount_incl_vat)}</td>
                </tr>
              ))}
              {!entries.items.length && <tr><td colSpan={9} style={{ textAlign: 'center' }}><Empty icon="⇣" text="No stock entries in range." /></td></tr>}
              {entries.items.length > 0 && (
                <tr style={{ background: '#eef2ea' }}>
                  <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmt(entries.total_litres, 3)} L</td>
                  <td />
                  <td className="num" style={{ fontWeight: 700 }}>{fmt(entries.total_excl)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmt(entries.total_vat)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmt(entries.total_incl)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}