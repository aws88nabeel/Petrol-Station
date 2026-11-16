import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Alert } from '../ui.jsx';

// Forced password change screen: shown when the logged-in user must set a new
// password (first login on a migrated deployment, or an admin reset).
export default function ChangePassword() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setOk('');
    if (String(newPassword).length < 8) return setError('New password must be at least 8 characters.');
    if (newPassword !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setOk('Password updated.');
      setTimeout(() => navigate('/'), 1200);
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
            <h1>Update password</h1>
            <div className="sub">Welcome {user?.full_name || user?.username}</div>
          </div>
        </div>
        <p className="hint">You must set a new password before using the system.</p>
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">{ok}</Alert>}
        <div className="field">
          <label>Current password</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            autoFocus autoComplete="current-password" />
        </div>
        <div className="field">
          <label>New password (min 8 chars)</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <button className="btn lg" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Saving…' : '→ Update password'}
        </button>
      </form>
    </div>
  );
}