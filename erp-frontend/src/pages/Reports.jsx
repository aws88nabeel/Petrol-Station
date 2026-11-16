import React, { useEffect, useState } from 'react';
import { api, downloadCSV, downloadPDF } from '../api.js';
import { PageHeader, Stat, Alert, Empty, fmt } from '../ui.jsx';

export default function Reports() {
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState([]); // range-based, by payment method
  const [profit, setProfit] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const date = new Date().toISOString().slice(0, 10);
    Promise.all([api.summaryByMethod(date, date), api.profitReport(date, date)])
      .then(([s, p]) => { setSummary(s); setProfit(p); })
      .catch((e) => setError(e.message));
  }, []);

  const run = async () => {
    try {
      if (!fromDate || !toDate) return;
      const [s, p] = await Promise.all([api.summaryByMethod(fromDate, toDate), api.profitReport(fromDate, toDate)]);
      setSummary(s); setProfit(p); setError('');
    } catch (e) { setError(e.message); }
  };

  const totalIncl = summary.reduce((a, b) => a + b.total_incl, 0) || 0;
  const totalProfit = summary.reduce((a, b) => a + b.total_profit, 0) || 0;
  const totalLitres = summary.reduce((a, b) => a + b.total_litres, 0) || 0;
  const maxIncl = Math.max(...(summary.map((r) => r.total_incl) || [0]));

  const exportPDF = async () => {
    try {
      await downloadPDF(`/export/pdf/report?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`, `sales-profit-report-${fromDate}-to-${toDate}.pdf`);
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <PageHeader title="Reports" sub="Sales summary and profit by product × payment method" actions={<button className="btn" onClick={exportPDF}>⬇ Export PDF (Oman)</button>} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="card card-pad">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <button className="btn" onClick={run} style={{ alignSelf: 'end' }}>Run report</button>
        </div>
      </div>

      <div className="grid grid-3 mt">
        <Stat label="Revenue" value={`OMR ${fmt(totalIncl)}`} sub={`${fromDate} → ${toDate}`} tone="blue" icon="﷼" />
        <Stat label="Gross profit" value={`OMR ${fmt(totalProfit)}`} sub={`${fromDate} → ${toDate}`} tone="purple" icon="✚" />
        <Stat label="Litre volume" value={`${fmt(totalLitres, 3)} L`} sub={`${fromDate} → ${toDate}`} tone="green" icon="≡" />
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Sales summary by payment method</h3>
          <button className="btn secondary sm" onClick={() => downloadCSV('profit-summary', { fromDate, toDate })}>CSV</button>
        </div>
        <div className="mt stack">
          {summary.map((r) => (
            <div className="progress-row" key={r.method_name}>
              <div className="lbl">{r.method_name}</div>
              <div className="bar" style={{ flex: 1 }}><div style={{ width: (r.total_incl / maxIncl) * 100 + '%' }} /></div>
              <div className="amt">OMR {fmt(r.total_incl)}</div>
            </div>
          ))}
          {!summary.length && <Empty icon="▤" text="No sales in range." />}
        </div>
        <table className="mt">
          <thead><tr><th>Method</th><th className="num">Sales</th><th className="num">Litres</th><th className="num">Excl VAT</th><th className="num">VAT</th><th className="num">Total</th><th className="num">Profit</th></tr></thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.method_name}>
                <td>{r.method_name}</td>
                <td className="num">{r.sale_count}</td>
                <td className="num">{fmt(r.total_litres, 3)}</td>
                <td className="num">{fmt(r.total_excl)}</td>
                <td className="num">{fmt(r.total_vat)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{fmt(r.total_incl)}</td>
                <td className="num" style={{ color: '#0d7a3e', fontWeight: 600 }}>{fmt(r.total_profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Profit by product × payment method</h3>
          <button className="btn secondary sm" onClick={() => downloadCSV('profit', { fromDate, toDate })}>CSV</button>
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Product</th><th>Payment method</th><th className="num">Litres</th><th className="num">Avg profit (baisa/L)</th><th className="num">Profit (OMR)</th><th className="num"># overrides</th></tr></thead>
            <tbody>
              {profit.map((r) => (
                <tr key={r.product_name + r.method_name}>
                  <td style={{ fontWeight: 600 }}>{r.product_name}</td>
                  <td>{r.method_name}</td>
                  <td className="num">{fmt(r.total_litres, 3)}</td>
                  <td className="num">{r.avg_profit_baisa}</td>
                  <td className="num" style={{ color: '#0d7a3e', fontWeight: 600 }}>{fmt(r.total_profit_omr)}</td>
                  <td className="num">{r.override_count > 0 ? <span className="override-on">{r.override_count}</span> : 0}</td>
                </tr>
              ))}
              {!profit.length && <tr><td colSpan={6} style={{ textAlign: 'center' }}><Empty icon="✎" text="No data in range." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}