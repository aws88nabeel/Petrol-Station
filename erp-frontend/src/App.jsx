import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';

// Pages are lazy-loaded so only the one you open is shipped to the browser.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const SalesEntry = lazy(() => import('./pages/SalesEntry.jsx'));
const SalesList = lazy(() => import('./pages/SalesList.jsx'));
const Stock = lazy(() => import('./pages/Stock.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const ReportsLayout = lazy(() => import('./pages/ReportsLayout.jsx'));
const StockVatReport = lazy(() => import('./pages/StockVatReport.jsx'));
const VatStatement = lazy(() => import('./pages/VatStatement.jsx'));
const ProfitRules = lazy(() => import('./pages/ProfitRules.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const ChangePassword = lazy(() => import('./pages/ChangePassword.jsx'));

const GROUPS = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: '⌂', end: true },
      { to: '/sales/new', label: 'New Sale', icon: '＋', tag: 'NEW' },
      { to: '/sales', label: 'Sales', icon: '≡', end: true },
      { to: '/stock', label: 'Stock', icon: '◫' },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { to: '/reports', label: 'Reports & PDF', icon: '▤' },
      { to: '/profit-rules', label: 'Profit Rules', icon: '✎' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/audit', label: 'Audit Log', icon: '◔' },
      { to: '/users', label: 'Users & Access', icon: '☺' },
    ],
  },
];

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/sales/new': 'New Sale',
  '/sales': 'Sales',
  '/stock': 'Stock',
  '/reports': 'Reports',
  '/reports/sales': 'Reports · Sales & profit',
  '/reports/stock': 'Reports · Stock (VAT split)',
  '/reports/vat': 'Reports · VAT statement',
  '/profit-rules': 'Profit Rules',
  '/audit': 'Audit Log',
  '/users': 'Users & Access',
  '/change-password': 'Change Password',
};

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const d = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Muscat', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const tm = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Muscat', hour: '2-digit', minute: '2-digit' });
  return <span className="clock">{d} · {tm} <span className="chip" style={{ marginLeft: 6 }}>GMT +4</span></span>;
}

function Shell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const initials = (user?.full_name || user?.username || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const role = (user?.role || '').toLowerCase();
  const crumb = PAGE_TITLES[location.pathname] || 'App';

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">⛽</div>
          <div>
            <div className="brand-title">Petrol Station</div>
            <small>Sales & Profit ERP</small>
          </div>
        </div>
        <nav className="nav">
          {GROUPS.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}>
                  <span className="ic">{n.icon}</span>{n.label}
                  {n.tag && <span className="tag">{n.tag}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="user">
          <div className="user-row">
            <div className="avatar">{initials}</div>
            <div>
              <div className="name">{user?.full_name || user?.username}</div>
              <span className={`role-pill ${role}`}>{user?.role}</span>
            </div>
          </div>
          <button className="logout" onClick={() => { logout(); navigate('/login'); }}>↩ Sign out</button>
        </div>
      </aside>
      <main className="content">
        <div className="topbar">
          <span className="crumb">Petrol Station <b>/</b> {crumb}</span>
          <div className="spacer" />
          <span className="station-chip"><span className="dot" />Petrol Station</span>
          <Clock />
        </div>
        {children}
      </main>
    </div>
  );
}

function Protected({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<div className="route-loading"><div className="spinner" />Loading…</div>}>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route path="/sales/new" element={<Protected><SalesEntry /></Protected>} />
        <Route path="/sales" element={<Protected><SalesList /></Protected>} />
        <Route path="/stock" element={<Protected><Stock /></Protected>} />
        <Route path="/reports" element={<Navigate to="/reports/sales" replace />} />
        <Route path="/reports/sales" element={<Protected><ReportsLayout /></Protected>}><Route index element={<Reports />} /></Route>
        <Route path="/reports/stock" element={<Protected><ReportsLayout /></Protected>}><Route index element={<StockVatReport />} /></Route>
        <Route path="/reports/vat" element={<Protected><ReportsLayout /></Protected>}><Route index element={<VatStatement />} /></Route>
        <Route path="/profit-rules" element={<Protected><ProfitRules /></Protected>} />
        <Route path="/audit" element={<Protected><Audit /></Protected>} />
        <Route path="/users" element={<Protected><Users /></Protected>} />
        <Route path="/change-password" element={<Protected><ChangePassword /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}