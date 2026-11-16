import React, { useEffect, useState } from 'react';
import { api, downloadCSV, downloadPDF } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PageHeader, Alert, fmt, fmt0 } from '../ui.jsx';
const PAGE_SIZE = 25;

export default function SalesList() {
  const { user } = useAuth();
  const [sales, setSales] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ litres: 0, incl: 0, profit: 0 });
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [error, setError] = useState('');

  const load = async (pageNo = 1) => {
    try {
      const params = { page: pageNo, limit: PAGE_SIZE };
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;
      const res = await api.listSales(params);
      setSales(res.items);
      setTotal(res.total);
      setTotals({ litres: res.totals.litres, incl: res.totals.incl, profit: res.totals.profit });
      setPage(res.page);
      setError('');
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); }, []);

  const goto = (p) => { if (p >= 1 && p <= Math.max(1, Math.ceil(total / PAGE_SIZE))) load(p); };

  const voidSale = async (id) => {
    const reason = prompt('Reason for voiding sale (manager action, audited):');
    if (!reason) return;
    try {
      await api.voidSale(id, reason);
      setPage(1);
      await load(page);
    } catch (e) { setError(e.message); }
  };

  const canVoid = user?.role === 'MANAGER' || user?.role === 'ADMIN';
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invoicePDF = async (s) => {
    try {
      await downloadPDF(`/export/pdf/invoice/${s.sale_id}`, `invoice-${s.sale_number}.pdf`);
    } catch (e) { setError(e.message); }
  };

  const filtered = !!(fromDate || toDate);

  return (
    <>
      <PageHeader
        title="Sales"
        sub={total ? `${total} sale${total === 1 ? '' : 's'} (page ${page} of ${pages})` : 'All recorded sales with profit breakdown'}
        actions={<button className="btn secondary" onClick={() => downloadCSV('sales', {})}>↓ Export CSV</button>}
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card card-pad">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <button className="btn" onClick={() => load(1)} style={{ alignSelf: 'end' }}>Filter</button>
          <button className="btn secondary" style={{ alignSelf: 'end' }} onClick={() => { setFromDate(''); setToDate(''); load(1); }}>Reset</button>
        </div>

        {total > 0 && (
          <div className="flex mt-sm" style={{ flexWrap: 'wrap' }}>
            <span className="chip">{filtered ? 'Filtered view' : 'All time'} <b>{fmt0(totals.litres)}</b> L</span>
            <span className="chip">Total <b>OMR {fmt(totals.incl)}</b></span>
            <span className="chip" style={{ borderColor: '#bfe8cf', color: '#0d7a3e', background: 'var(--success-soft)' }}>Profit <b>OMR {fmt(totals.profit)}</b></span>
          </div>
        )}

        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Sale #</th><th>Date</th><th>Method</th><th className="num">Litres</th><th className="num">Excl VAT</th><th className="num">VAT</th><th className="num">Total</th><th className="num">Profit</th><th>Status</th><th>Notes</th><th>Invoice</th>{canVoid && <th></th>}</tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.sale_id}>
                  <td style={{ fontWeight: 600 }}>{s.sale_number}</td>
                  <td>{s.sale_date}</td>
                  <td><span className="badge blue">{s.method_name}</span></td>
                  <td className="num">{fmt(s.total_litres, 3)}</td>
                  <td className="num">{fmt(s.subtotal_excl_vat)}</td>
                  <td className="num">{fmt(s.vat_amount)}</td>
                  <td className="num">{fmt(s.total_incl_vat)}</td>
                  <td className="num" style={{ color: '#0d7a3e', fontWeight: 600 }}>{fmt(s.total_profit_omr)}</td>
                  <td><span className={`badge ${s.status === 'COMPLETED' ? 'green' : 'red'}`}>{s.status}</span></td>
                  <td style={{ maxWidth: 180 }}>{s.notes ? <span className="muted" title={s.notes}>{s.notes}</span> : '—'}</td>
                  <td>{s.status === 'COMPLETED' && <button className="btn secondary sm" onClick={() => invoicePDF(s)}>⬇ PDF</button>}</td>
                  {canVoid && s.status === 'COMPLETED' && <td><button className="btn danger sm" onClick={() => voidSale(s.sale_id)}>Void</button></td>}
                </tr>
              ))}
              {!sales.length && <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 28 }}>No sales match the filters.</td></tr>}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex mt" style={{ justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
            <button className="btn secondary sm" disabled={page <= 1} onClick={() => goto(page - 1)}>← Prev</button>
            <span className="hint">Page {page} of {pages} · {total} total</span>
            <button className="btn secondary sm" disabled={page >= pages} onClick={() => goto(page + 1)}>Next →</button>
          </div>
        )}
      </div>
    </>
  );
}