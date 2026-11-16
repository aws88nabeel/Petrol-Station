import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Alert } from '../ui.jsx';

const DEMO = [
  { u: 'admin', p: 'admin123', label: 'Administrator' },
  { u: 'manager', p: 'manager123', label: 'Site Manager' },
  { u: 'cashier', p: 'cashier123', label: 'Cashier' },
  { u: 'viewer', p: 'viewer123', label: 'Read-only' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const fill = (u, p) => { setUsername(u); setPassword(p); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(username, password);
      navigate(u.must_change_password ? '/change-password' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="mark">⛽</div>
          <div>
            <h1>Petrol Station</h1>
            <div className="sub">Sales & profit governance · manual entry</div>
          </div>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="btn lg" style={{ width: '100%' }} disabled={busy}>
          {busy ? <><span className="spinner" style={{ borderWidth: 2, width: 16, height: 16 }} /> Signing in…</> : '→ Sign in'}
        </button>

        <p className="hint" style={{ margin: '18px 0 8px' }}>Quick demo — tap an account to fill it in:</p>
        <div className="demo-list">
          {DEMO.map((d) => (
            <button type="button" key={d.u} className="demo" onClick={() => fill(d.u, d.p)}>
              <span className="u">{d.u}</span>
              <span className="p">{d.label}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}