import React from 'react';
import { Link } from 'react-router-dom';

// Shared number formatters (money = 6 decimals, litres default 3 where used).
export const fmt = (n, d = 6) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });

// Consistent page title + subtitle + optional action slot.
export function PageHeader({ title, sub, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// Dashboard-style stat card.
export function Stat({ label, value, sub, tone = 'blue', icon }) {
  return (
    <div className={`card stat ${tone}`}>
      <div className="label">{icon && <span className="ic">{icon}</span>}{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// Centered empty state.
export function Empty({ icon = '◦', text }) {
  return (
    <div className="empty">
      <div className="e-ic">{icon}</div>
      <div>{text || 'No records found.'}</div>
    </div>
  );
}

// Inline loading row.
export function Loading({ text = 'Loading…' }) {
  return (
    <div className="loading"><div className="spinner" />{text}</div>
  );
}

// Non-dismissable alert banner.
export function Alert({ tone = 'error', children }) {
  const ic = tone === 'error' ? '⚠' : tone === 'success' ? '✓' : tone === 'warn' ? '◐' : 'ℹ';
  return (
    <div className={`alert ${tone}`}>
      <span className="al-ic">{ic}</span>
      <div>{children}</div>
    </div>
  );
}

// Quick-action tile that links somewhere.
export function QuickAction({ to, icon, tone, title, sub }) {
  return (
    <Link className="qa" to={to}>
      <div className={`qa-ic ${tone}`}>{icon}</div>
      <div className="qa-t">{title}</div>
      <div className="qa-s">{sub}</div>
    </Link>
  );
}