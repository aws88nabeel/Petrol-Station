import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageHeader, Alert, fmt } from '../ui.jsx';

export default function VatStatement() {
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [stmt, setStmt] = useState({ input: { excl: 0, vat: 0, incl: 0, litres: 0 }, output: { excl: 0, vat: 0, incl: 0 }, net_vat: 0 });
  const [error, setError] = useState('');

  const load = (f, t) => api.vatStatement(f, t).then(setStmt);

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

  const net = stmt.net_vat;
  const payable = net >= 0;

  return (
    <>
      <PageHeader title="VAT statement" sub="Input VAT paid to the supplier on stock purchases vs output VAT received from customers on sales" />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="card card-pad">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <button className="btn" onClick={run} style={{ alignSelf: 'end' }}>Run statement</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>Net VAT = output VAT received − input VAT paid. VAT at 5% of the exclusive amount (5/105 of VAT-inclusive amounts).</p>
      </div>

      <div className="card card-pad mt">
        <h3 style={{ margin: 0 }}>Input VAT — paid to Oman Oil on stock purchases</h3>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Value excl VAT</th><th className="num">VAT 5%</th><th className="num">Value incl VAT</th><th className="num">Stock received</th></tr></thead>
            <tbody>
              <tr>
                <td>{fmt(stmt.input.excl)}</td>
                <td className="num" style={{ color: '#b45309', fontWeight: 600 }}>{fmt(stmt.input.vat)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{fmt(stmt.input.incl)}</td>
                <td className="num">{fmt(stmt.input.litres, 3)} L</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad mt">
        <h3 style={{ margin: 0 }}>Output VAT — received from customers (sales)</h3>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Value excl VAT</th><th className="num">VAT 5%</th><th className="num">Value incl VAT</th></tr></thead>
            <tbody>
              <tr>
                <td>{fmt(stmt.output.excl)}</td>
                <td className="num" style={{ color: '#b45309', fontWeight: 600 }}>{fmt(stmt.output.vat)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{fmt(stmt.output.incl)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad mt">
        <div className="spread"><h3 style={{ margin: 0 }}>Net VAT {payable ? 'PAYABLE' : 'RECOVERABLE'}</h3>
          <span className="muted hint">{payable ? 'output − input' : 'input − output'}</span>
        </div>
        <p style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 0', color: payable ? '#b42318' : '#067647' }}>OMR {fmt(Math.abs(net))}</p>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {payable
            ? `To pay to tax authority after offsetting the ${fmt(stmt.input.vat)} input VAT against the ${fmt(stmt.output.vat)} output VAT collected from customers.`
            : `Excess input VAT (${fmt(stmt.input.vat)} paid − ${fmt(stmt.output.vat)} collected) carried forward / recoverable.`}
        </p>
      </div>
    </>
  );
}