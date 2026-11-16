import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PageHeader, Alert, Empty, Stat } from '../ui.jsx';

export default function ProfitRules() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [rules, setRules] = useState([]);
  const [catalog, setCatalog] = useState({ products: [], paymentMethods: [] });
  const [drafts, setDrafts] = useState({});
  const [form, setForm] = useState({ productId: '', methodId: '', profit: '0', reason: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [r, c] = await Promise.all([api.profitRules(), api.catalog()]);
    setRules(r);
    setCatalog({ products: c.products || [], paymentMethods: c.paymentMethods || [] });
    const d = {};
    for (const rule of r) {
      d[rule.rule_id] = { profit: String(rule.default_profit_baisa), active: !!rule.is_active, reason: '' };
    }
    setDrafts(d);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try { await load(); }
      catch (e) { if (alive) setError(e.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const configuredKeys = useMemo(() => new Set(rules.map((r) => `${r.product_id}:${r.method_id}`)), [rules]);
  const activeCount = rules.filter((r) => r.is_active).length;

  const setDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  const flash = (msg) => { setSuccess(msg); setError(''); };
  const fail = (msg) => { setError(msg); setSuccess(''); };

  const createRule = async (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    const productId = Number(form.productId);
    const methodId = Number(form.methodId);
    if (!productId || !methodId) return fail('Select a product and a payment method.');
    if (configuredKeys.has(`${productId}:${methodId}`)) return fail('A rule for this product and payment method already exists. Edit it below instead.');
    if (!String(form.reason || '').trim()) return fail('A reason is required to add a profit rule.');
    setCreating(true);
    try {
      await api.createProfitRule({
        product_id: productId,
        method_id: methodId,
        default_profit_baisa: Number(form.profit),
        is_active: 1,
        reason: form.reason.trim(),
      });
      setForm({ productId: '', methodId: '', profit: '0', reason: '' });
      flash('Profit rule added.');
      await load();
    } catch (e2) { fail(e2.message); }
    finally { setCreating(false); }
  };

  const saveRule = async (rule) => {
    if (!isAdmin) return;
    const draft = drafts[rule.rule_id] || {};
    if (!String(draft.reason || '').trim()) return fail('A reason is required to save changes to a profit rule.');
    const dirty = Number(draft.profit) !== Number(rule.default_profit_baisa) || !!draft.active !== !!rule.is_active;
    if (!dirty) return fail('No changes to save for this rule.');
    setSavingId(rule.rule_id);
    try {
      await api.updateProfitRule(rule.rule_id, {
        default_profit_baisa: Number(draft.profit),
        is_active: draft.active ? 1 : 0,
        reason: draft.reason.trim(),
      });
      flash(`Updated ${rule.product_name} / ${rule.method_name}.`);
      await load();
    } catch (e) { fail(e.message); }
    finally { setSavingId(null); }
  };

  const removeRule = async (rule) => {
    if (!isAdmin) return;
    const reason = window.prompt(`Reason to remove the rule for ${rule.product_name} / ${rule.method_name}?`);
    if (reason === null) return;
    if (!String(reason).trim()) return fail('A reason is required to remove a profit rule.');
    setSavingId(rule.rule_id);
    try {
      await api.deleteProfitRule(rule.rule_id, reason.trim());
      flash(`Removed ${rule.product_name} / ${rule.method_name}.`);
      await load();
    } catch (e) { fail(e.message); }
    finally { setSavingId(null); }
  };

  const selectedConfigured = form.productId && form.methodId && configuredKeys.has(`${form.productId}:${form.methodId}`);

  return (
    <>
      <PageHeader
        title="Profit Rules"
        sub="Configure default profit (baisa per litre) per product and payment method. Rules are fully dynamic per station — every product/method used in a sale must have an active rule."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="grid grid-3">
        <Stat label="Configured rules" value={rules.length} sub="Product × payment method rules" tone="blue" icon="✎" />
        <Stat label="Active rules" value={activeCount} sub="Available for new sales" tone={activeCount ? 'green' : 'amber'} icon="◫" />
        <Stat label="Access" value={isAdmin ? 'Admin' : 'View only'} sub={isAdmin ? 'You can add, edit and remove rules' : 'Only admins can change rules'} tone={isAdmin ? 'green' : 'gray'} icon={isAdmin ? '✓' : '◔'} />
      </div>

      <div className="card card-pad mt">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Configured rules</h3>
          <span className="chip">{rules.length} rule{rules.length === 1 ? '' : 's'}</span>
        </div>
        <p className="hint mt">No built-in defaults. Add the combinations your station uses, set their profit per litre, and keep them active for sales.</p>
        <div className="table-wrap mt">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Payment method</th>
                <th className="num" style={{ width: 170 }}>Profit (baisa/L)</th>
                <th style={{ width: 140 }}>Status</th>
                <th>Reason for change</th>
                <th style={{ width: 180 }} />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6}><div className="loading"><div className="spinner" />Loading rules…</div></td></tr>}
              {!loading && rules.map((r) => {
                const draft = drafts[r.rule_id] || { profit: String(r.default_profit_baisa), active: !!r.is_active, reason: '' };
                const dirty = Number(draft.profit) !== Number(r.default_profit_baisa) || !!draft.active !== !!r.is_active;
                return (
                  <tr key={r.rule_id} style={{ opacity: r.is_active ? 1 : 0.72 }}>
                    <td><strong>{r.product_name}</strong><div className="hint">{r.product_code}</div></td>
                    <td>{r.method_name}<div className="hint">{r.method_code} · {r.method_category || '—'}</div></td>
                    <td className="num">
                      {isAdmin ? (
                        <input
                          type="number" step="0.001" min="0" max="1000"
                          value={draft.profit}
                          onChange={(e) => setDraft(r.rule_id, { profit: e.target.value })}
                          style={{ width: 120, textAlign: 'right' }}
                        />
                      ) : <strong>{Number(r.default_profit_baisa).toLocaleString('en-US', { maximumFractionDigits: 3 })}</strong>}
                    </td>
                    <td>
                      {isAdmin ? (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                          <input type="checkbox" checked={!!draft.active} onChange={(e) => setDraft(r.rule_id, { active: e.target.checked })} />
                          {draft.active ? 'Active' : 'Inactive'}
                        </label>
                      ) : (
                        <span className={`badge ${r.is_active ? 'green' : 'gray'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
                      )}
                    </td>
                    <td>
                      {isAdmin ? (
                        <input
                          value={draft.reason || ''}
                          onChange={(e) => setDraft(r.rule_id, { reason: e.target.value })}
                          placeholder={dirty ? 'Required to save…' : 'Reason if you change this'}
                        />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      {isAdmin ? (
                        <div className="flex" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button className="btn secondary sm" disabled={!dirty || savingId === r.rule_id} onClick={() => saveRule(r)}>
                            {savingId === r.rule_id ? 'Saving…' : 'Save'}
                          </button>
                          <button className="btn sm" style={{ background: 'var(--danger-soft, #fdecec)', color: 'var(--danger, #c62828)', border: '1px solid #f3c2c2' }} disabled={savingId === r.rule_id} onClick={() => removeRule(r)}>
                            Remove
                          </button>
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!loading && !rules.length && <tr><td colSpan={6}><Empty icon="✎" text="No profit rules configured yet. Add rules below before recording sales." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2 mt">
        {isAdmin && (
          <div className="card card-pad">
            <h3 style={{ margin: 0 }}>Add profit rule</h3>
            <p className="hint mt">Add rules for the product and payment-method combinations this station uses. No combinations are preconfigured.</p>
            <form onSubmit={createRule} className="mt">
              <div className="field">
                <label>Product <span className="req">*</span></label>
                <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  <option value="">— Select product —</option>
                  {catalog.products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Payment method <span className="req">*</span></label>
                <select value={form.methodId} onChange={(e) => setForm({ ...form, methodId: e.target.value })}>
                  <option value="">— Select payment method —</option>
                  {catalog.paymentMethods.map((m) => <option key={m.method_id} value={m.method_id}>{m.method_name}{m.category ? ` (${m.category})` : ''}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Default profit (baisa per litre) <span className="req">*</span></label>
                <input type="number" step="0.001" min="0" max="1000" value={form.profit} onChange={(e) => setForm({ ...form, profit: e.target.value })} />
                <span className="hint">Default profit applied on new sales for this combination (where overrides are allowed).</span>
              </div>
              <div className="field">
                <label>Reason <span className="req">*</span></label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why is this rule being added?" />
              </div>
              {selectedConfigured && <Alert tone="warn">This combination already has a rule. Edit or reactivate it in the table above.</Alert>}
              <button className="btn" type="submit" disabled={creating || selectedConfigured}>{creating ? 'Adding…' : '+ Add rule'}</button>
            </form>
          </div>
        )}

        <div className="card card-pad">
          <h3 style={{ margin: 0 }}>Setup guidance</h3>
          <div className="stack mt" style={{ gap: 10 }}>
            <div className="hint"><strong>1. Add as you go.</strong> Configure only the product and payment-method combinations this station actually uses, when you start using the app.</div>
            <div className="hint"><strong>2. Required for sales.</strong> A sale is allowed only when an active rule exists for the selected product and payment method.</div>
            <div className="hint"><strong>3. Reason & audit.</strong> Adding, changing, deactivating, or removing a rule requires a reason and is recorded in the audit trail.</div>
            <div className="hint"><strong>4. Profit unit.</strong> Values are in <strong>baisa per litre</strong> (e.g. 7.000). Line profit is calculated as <code>(litres × baisa) / 1000</code> OMR.</div>
          </div>
          {!isAdmin && <div className="mt"><Alert tone="info">Only administrators can add, change, or remove profit rules.</Alert></div>}
        </div>
      </div>
    </>
  );
}
