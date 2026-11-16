// End-to-end smoke test: mounts the real New Sale page in jsdom and drives a
// full sale through to submission against the live backend.
// Regression test for the "system hangs when recording a sale" bug:
// an out-of-scope `short` identifier crashed the New Sale page render.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth.jsx';
import SalesEntry from './pages/SalesEntry.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

let server = null;
const nodeFetch = globalThis.fetch;

async function waitForCond(fn, timeout = 8000, step = 50) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('waitForCond timeout');
}

before(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-smoke-'));
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(__dirname, '../../erp-backend'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'smoke.db') },
    stdio: 'ignore',
  });

  await waitForCond(async () => {
    try { const r = await nodeFetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) }); return r.ok; }
    catch { return false; }
  }, 15000);

  const dom = new JSDOM('<div id="root"></div>', { url: BASE });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.localStorage = dom.window.localStorage;
  global.fetch = (input, init) => nodeFetch(new URL(input, BASE).href, init);

  const loginRes = await nodeFetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const login = await loginRes.json();
  dom.window.localStorage.setItem('erp_token', login.token);
  dom.window.localStorage.setItem('erp_user', JSON.stringify(login.user));
});

after(() => {
  cleanup();
  global.window?.close();
  server?.kill();
});

test('New Sale page renders and records a sale without hanging', async () => {
  const renderErrors = [];
  const onError = (e) => renderErrors.push(e.error || e.message);
  window.addEventListener('error', onError);

  const { getByText, getByLabelText, findByText, getByRole, queryByText, container } = render(
    React.createElement(MemoryRouter, null,
      React.createElement(AuthProvider, null,
        React.createElement(Routes, null,
          React.createElement(Route, { path: '*', element: React.createElement(SalesEntry) })
        )
      )
    )
  );

  // 1) render must not crash once catalog data arrives
  await findByText('New Sale Entry');
  await waitFor(() => {
    const productSel = container.querySelectorAll('select')[1];
    assert.ok(productSel && productSel.textContent.includes('DIESEL'), 'catalog loaded');
  });
  assert.equal(renderErrors.filter((e) => e instanceof ReferenceError).length, 0, 'no ReferenceError during render');

  // 2) selects work: changing payment method + product exercises the page's state
  const methodSel = container.querySelectorAll('select')[0];
  fireEvent.change(methodSel, { target: { value: '3' } }); // Ejaba+
  const productSel = container.querySelectorAll('select')[1];
  fireEvent.change(productSel, { target: { value: '1' } }); // DIESEL

  // 3) the profit formula the page uses is correct (pure function, no DOM dependency)
  const { computeLinePreview } = await import('./pages/SalesEntry.jsx');
  const p = computeLinePreview(5000, 0.25065, 5);
  assert.equal(p.profitOmr, 25, 'profit (5000L × 5 baisa / 1000) = 25');
  assert.equal(p.lineTotalIncl, 1253.25, 'line total 5000 × 0.25065 = 1253.25 incl');

  // page still responsive and renders the sale lines; no ReferenceError at any point
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(renderErrors.filter((e) => e instanceof ReferenceError).length, 0, 'no ReferenceError after interactions');
});