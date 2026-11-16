import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PageHeader, Alert, Empty } from '../ui.jsx';

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'CASHIER' });

  const isAdmin = user?.role === 'ADMIN';

  const load = async () => {
    try { setUsers(await api.users()); setError(''); } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.createUser(form);
      setSuccess(`User ${form.username} created.`);
      setForm({ username: '', password: '', full_name: '', role: 'CASHIER' });
      await load();
    } catch (err) { setError(err.message); }
  };

  const ROLE_HINTS = {
    ADMIN: 'Full access: edit rules, manage users, void sales',
    MANAGER: 'Override profit, void sales, record stock receipts',
    CASHIER: 'Enter sales only (no overrides, no voids)',
    VIEWER: 'Read-only access to reports and audit',
  };

  return (
    <>
      <PageHeader title="Users & Access" sub="Role-based access control" />
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="grid grid-2">
        <div className="card card-pad">
          <div className="spread">
            <h3 style={{ margin: 0 }}>Users</h3>
            <span className="chip">{users.length} account{users.length === 1 ? '' : 's'}</span>
          </div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td>{u.full_name}</td>
                    <td><span className={`role-pill ${u.role.toLowerCase()}`}>{u.role}</span></td>
                    <td><span className={`badge ${u.is_active ? 'green' : 'gray'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={4}><Empty icon="☺" text="No users yet." /></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt">
            <h4 style={{ marginBottom: 4 }}>Role permissions</h4>
            <div className="stack" style={{ gap: 4 }}>
              {Object.entries(ROLE_HINTS).map(([r, h]) => <div key={r} className="hint"><span className="role-pill" style={{ background: 'var(--surface-3)', color: 'var(--text-2)', marginRight: 6 }}>{r}</span>{h}</div>)}
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="card card-pad">
            <h3 style={{ margin: 0 }}>Create user</h3>
            <form onSubmit={create} className="mt">
              <div className="field"><label>Username <span className="req">*</span></label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
              <div className="field"><label>Full name <span className="req">*</span></label><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
              <div className="field"><label>Password <span className="req">*</span></label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              <div className="field"><label>Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option>CASHIER</option><option>MANAGER</option><option>ADMIN</option><option>VIEWER</option>
                </select>
              </div>
              <button className="btn">+ Create user</button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}