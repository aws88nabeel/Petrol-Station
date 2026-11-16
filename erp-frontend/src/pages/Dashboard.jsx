import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { PageHeader, Stat, Empty, QuickAction } from '../ui.jsx';

const fmt = (n, d = 3) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const TANK_CAP = 100000;

export default function Dashboard() {
  const navigate = useNavigate();
  const [today, setToday] = useState(null);
  const [stock, setStock] = useState([]);
  const [rules, setRules] = useState([]);
  const [error, setError] = useState('');
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    Promise.all([api.dailyReport(todayStr), api.stockBalance(), api.profitRules()])
      .then(([daily, bal, rl]) => { setToday(daily); setStock(bal); setRules(rl); })
      .catch((e) => setError(e.message));
  }, []);

  const totalIncl = today?.byPaymentMethod?.reduce((a, b) => a + b.total_incl, 0) || 0;
  const totalProfit = today?.byPaymentMethod?.reduce((a, b) => a + b.total_profit, 0) || 0;
  const totalSales = today?.byPaymentMethod?.reduce((a, b) => a + b.sale_count, 0) || 0;
  const totalLitres = today?.byPaymentMethod?.reduce((a, b) => a + b.total_litres, 0) || 0;
  const maxMethod = Math.max(...(today?.byPaymentMethod?.map((m) => m.total_incl) || [0]));

  const dates = todayStr.split('-');
  const dateLabel = new Date(Date.UTC(...dates)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <PageHeader title="Dashboard" sub={dateLabel} />

      {error && <div className="alert error">{error}</div>}

      <div className="hero mb">
        <div>
          <h2>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {today ? 'Station Ops' : ''}</h2>
          <p>Cash, Visa and OOMCO platform billing at a glance.</p>
        </div>
        <div>
          <div className="big" style={{ textAlign: 'right' }}>OMR {fmt(totalIncl, 6)}</div>
          <p style={{ margin: 0, textAlign: 'right' }}>revenue incl. VAT — today</p>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="Sales today" value={totalSales} sub={`${fmt(totalLitres)} litres dispensed`} tone="blue" icon="≡" />
        <Stat label="Revenue (incl VAT)" value={`OMR ${fmt(totalIncl, 6)}`} sub={`${totalSales} transaction${totalSales === 1 ? '' : 's'}`} tone="green" icon="﷼" />
        <Stat label="Gross profit" value={`OMR ${fmt(totalProfit, 6)}`} sub="Platform profit billed" tone="purple" icon="✚" />
        <Stat label="Stock on hand" value={fmt(stock.reduce((a, s) => a + s.balance_litres, 0), 0) + ' L'} sub={`${stock.filter((s) => s.balance_litres >= 20000).length}/${stock.length} tanks healthy`} tone="amber" icon="◫" />
      </div>

      <div className="grid grid-2 mt">
        <div className="card card-pad">
          <div className="spread">
            <h3 style={{ margin: 0 }}>Sales by payment method</h3>
            <Linkish to="/sales" label="All sales" navigate={navigate} />
          </div>
          <div className="mt stack">
            {(today?.byPaymentMethod || []).map((r) => (
              <div className="progress-row" key={r.method_name}>
                <div className="lbl">{r.method_name}</div>
                <div className="bar bad" style={{ flex: 1 }}><div style={{ width: (r.total_incl / maxMethod) * 100 + '%' }} /></div>
                <div className="amt">{fmt(r.total_incl, 6)} OMR</div>
              </div>
            ))}
            {!today?.byPaymentMethod?.length && <Empty icon="≡" text="No sales recorded today." />}
          </div>
          {(today?.byPaymentMethod || []).length > 0 && (
            <table className="mt">
              <thead><tr><th>Method</th><th className="num">Sales</th><th className="num">Litres</th><th className="num">Profit</th></tr></thead>
              <tbody>
                {(today?.byPaymentMethod || []).map((r) => (
                  <tr key={r.method_name}>
                    <td>{r.method_name}</td>
                    <td className="num">{r.sale_count}</td>
                    <td className="num">{fmt(r.total_litres, 3)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmt(r.total_profit, 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card card-pad">
          <div className="spread">
            <h3 style={{ margin: 0 }}>Stock position</h3>
            <Linkish to="/stock" label="Manage" navigate={navigate} />
          </div>
          <div className="mt stack">
            {stock.map((s) => {
              const pct = Math.min(100, Math.round((s.balance_litres / TANK_CAP) * 100));
              const tone = s.balance_litres <= 0 ? 'bad' : s.balance_litres < 20000 ? 'warn' : 'good';
              return (
                <div className="progress-row" key={s.product_id}>
                  <div className="lbl">{s.product_name}</div>
                  <div className={`bar ${tone}`} style={{ flex: 1 }}><div style={{ width: pct + '%' }} /></div>
                  <div className="amt">{fmt(s.balance_litres)} L</div>
                </div>
              );
            })}
            {!stock.length && <Empty icon="◫" text="No stock entries yet." />}
          </div>
          {stock.some((s) => s.balance_litres < 20000) && (
            <div className="alert warn mt-sm">Some tanks are low — record a receipt to top them up.</div>
          )}
        </div>
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Quick actions</h3>
          <span className="chip">Cash & VISA @ 7 · Ejaba+ & E-Fill @ 5 baisa/L</span>
        </div>
        <div className="qa-grid mt">
          <QuickAction to="/sales/new" icon="＋" tone="green" title="New sale" sub="Enter a manual sale" />
          <QuickAction to="/stock" icon="◫" tone="amber" title="Record receipt" sub="Top up stock" />
          <QuickAction to="/reports" icon="▤" tone="blue" title="Daily report" sub="Stats + Oman PDF" />
          <QuickAction to="/profit-rules" icon="✎" tone="purple" title="Profit rules" sub="Review the rate table" />
        </div>
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Active profit rates</h3>
          <Linkish to="/profit-rules" label="Edit rates" navigate={navigate} />
        </div>
        <div className="mt flex" style={{ flexWrap: 'wrap' }}>
          {rules.filter((r) => r.is_active).map((r) => (
            <span className="chip" key={r.rule_id}>{r.product_name} · {r.method_name} <b style={{ color: 'var(--primary)' }}>{r.default_profit_baisa}</b> baisa/L</span>
          ))}
          {!rules.some((r) => r.is_active) && <Empty icon="✎" text="No active profit rules." />}
        </div>
      </div>
    </>
  );
}

function Linkish({ to, label, navigate }) {
  return <a className="chip clickable" href={to} onClick={(e) => { e.preventDefault(); navigate(to); }}>{label} →</a>;
}