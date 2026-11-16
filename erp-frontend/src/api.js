// Thin API client. Uses /api relative paths so Vite proxies to the backend.
// GET responses are cached in memory for a few seconds and in-flight duplicate
// requests are coalesced, so repeated page mounts / double effects don't hit the
// network twice. Any write clears the GET cache immediately.
const TOKEN_KEY = 'erp_token';
const USER_KEY = 'erp_user';
const GET_TTL_MS = 3000;

const cache = new Map();     // key -> { expires, data }
const inflight = new Map();  // key -> Promise (dedupe simultaneous GETs)

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch { return null; }
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  cache.clear();
}

const cacheKey = (method, path, body) => method + ' ' + path + (body ? ' ' + JSON.stringify(body) : '');

async function request(method, path, body) {
  const key = cacheKey(method, path, body);
  if (method === 'GET') {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data;
    if (inflight.has(key)) return inflight.get(key);
  } else {
    cache.clear();
  }

  const p = (async () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out. Check that the backend is running (port 4000).');
      if (e instanceof TypeError && /fetch/i.test(e.message)) {
        throw new Error('Cannot reach the backend. Is the server running?');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const message = (data && data.error) ? data.error : `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    if (method === 'GET') cache.set(key, { expires: Date.now() + GET_TTL_MS, data });
    return data;
  })();

  if (method === 'GET') inflight.set(key, p);
  p.finally(() => inflight.delete(key)).catch(() => {});
  return p;
}

export const api = {
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  changePassword: (payload) => request('POST', '/auth/change-password', payload),
  catalog: () => request('GET', '/catalog'),
  // sales
  createSale: (payload) => request('POST', '/sales', payload),
  listSales: (params = {}) => request('GET', '/sales?' + new URLSearchParams(params).toString()),
  getSale: (id) => request('GET', '/sales/' + id),
  voidSale: (id, reason) => request('POST', `/sales/${id}/void`, { reason }),
  // stock
  stockBalance: () => request('GET', '/stock/balance'),
  stockValuation: () => request('GET', '/stock/valuation'),
  stockLedger: (params = {}) => request('GET', '/stock/ledger?' + new URLSearchParams(params).toString()),
  stockReceipt: (payload) => request('POST', '/stock/receipt', payload),
  setStockBalance: (payload) => request('POST', '/stock/balance', payload),
  // reports
  dailyReport: (date) => request('GET', '/reports/daily?date=' + encodeURIComponent(date)),
  profitReport: (fromDate, toDate) => request('GET', `/reports/profit?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`),
  summaryByMethod: (fromDate, toDate) => request('GET', `/reports/summary?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`),
  stockEntriesReport: (fromDate, toDate) => request('GET', `/reports/stock-entries?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`),
  vatStatement: (fromDate, toDate) => request('GET', `/reports/vat-statement?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`),
  // profit rules + audit
  profitRules: () => request('GET', '/profit-rules'),
  createProfitRule: (payload) => request('POST', '/profit-rules', payload),
  updateProfitRule: (id, payload) => request('PUT', '/profit-rules/' + id, payload),
  deleteProfitRule: (id, reason) => request('DELETE', '/profit-rules/' + id, { reason }),
  overrideAudit: (fromDate, toDate) => request('GET', `/audit/override?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`),
  auditLog: () => request('GET', '/audit/log'),
  // users
  users: () => request('GET', '/users'),
  createUser: (payload) => request('POST', '/users', payload),
};

// Shared downloader for token-protected CSV/PDF endpoints.
async function download(url, filename) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Download timed out.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = 'Download failed (' + res.status + ')';
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export const downloadCSV = (kind, params = {}) => {
  const q = new URLSearchParams(params).toString();
  return download(`/api/export/csv/${kind}${q ? '?' + q : ''}`, `${kind}-${new Date().toISOString().slice(0, 10)}.csv`);
};

export const downloadPDF = (path, filename) => download('/api' + path, filename || 'report.pdf');
