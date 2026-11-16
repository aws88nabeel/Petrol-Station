import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageHeader, Alert, Empty } from '../ui.jsx';

const ACTION_TONE = { INSERT: 'blue', UPDATE: 'amber', DELETE: 'red', VOID_SALE: 'red', SALE: 'green' };

export default function Audit() {
  const [overrides, setOverrides] = useState([]);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.overrideAudit('1970-01-01', '2999-12-31'), api.auditLog()])
      .then(([o, l]) => { setOverrides(o); setLog(l); })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader title="Audit" sub="Profit override history and system audit log" />
      {error && <Alert tone="error">{error}</Alert>}

      <div className="card card-pad">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Profit overrides on sales</h3>
          <span className="chip">{overrides.length} override{overrides.length === 1 ? '' : 's'}</span>
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>When</th><th>Sale #</th><th>Product</th><th>Payment method</th><th className="num">Original</th><th className="num">Overridden</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.audit_id}>
                  <td>{o.overridden_at}</td>
                  <td style={{ fontWeight: 600 }}>{o.sale_number}</td>
                  <td>{o.product_name}</td>
                  <td>{o.method_name}</td>
                  <td className="num">{o.original_profit}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{o.overridden_profit}</td>
                  <td>{o.override_reason}</td>
                  <td>{o.overridden_by || '—'}</td>
                </tr>
              ))}
              {!overrides.length && <tr><td colSpan={8}><Empty icon="✎" text="No overrides recorded." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>System audit log</h3>
          <span className="chip">{log.length} entr{log.length === 1 ? 'y' : 'ies'}</span>
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Table</th><th>Record</th><th>Details</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.log_id}>
                  <td>{l.created_at}</td>
                  <td>{l.full_name || `#${l.user_id}`}</td>
                  <td><span className={`badge ${ACTION_TONE[l.action] || 'gray'}`}>{l.action}</span></td>
                  <td>{l.table_name}</td>
                  <td>{l.record_id ?? '—'}</td>
                  <td className="hint" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.new_values || l.old_values || ''}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan={6}><Empty icon="◔" text="No audit entries." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}