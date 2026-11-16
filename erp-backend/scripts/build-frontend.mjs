// Builds the React frontend and places the output into erp-backend/public so
// the Express server can serve the SPA at / in production (Hostinger build step).
//
//   usage:  node scripts/build-frontend.mjs
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(__dirname, '..');
const FRONTEND = path.join(BACKEND, '..', 'erp-frontend');
const OUTDIR = path.join(BACKEND, 'public');
const node = process.execPath;

if (!fs.existsSync(path.join(FRONTEND, 'package.json'))) {
  console.error(`Frontend not found at ${FRONTEND}`);
  process.exit(1);
}

// Some Node platforms do not run `npm install` for archive deployments. Backend
// deps are required at boot, so install them when missing (idempotent + fast
// when already present). Frontend deps are handled below.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const missingBackendDeps = !fs.existsSync(path.join(BACKEND, 'node_modules', 'mysql2'))
  || !fs.existsSync(path.join(BACKEND, 'node_modules', 'express'));
if (missingBackendDeps) {
  console.log('[build] installing backend deps (npm ci)…');
  const br = spawnSync(npm, ['ci', '--prefix', BACKEND], { stdio: 'inherit', shell: true });
  if (br.status !== 0) process.exit(br.status || 1);
}

// Ensure the frontend dependencies are installed (npm ci for reproducibility).
if (!fs.existsSync(path.join(FRONTEND, 'node_modules', '.bin', 'vite.cmd'))) {
  console.log('[build] installing frontend deps (npm ci)…');
  const r = spawnSync(npm, ['ci', '--prefix', FRONTEND], { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status || 1);
}

// Clean the previous build so stale assets can't linger and collide.
fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.mkdirSync(OUTDIR, { recursive: true });

console.log('[build] running vite build → ' + OUTDIR);
const viteBin = path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(node, [viteBin, 'build', '--outDir', OUTDIR, '--emptyOutDir', '--config', path.join(FRONTEND, 'vite.config.js')], {
  cwd: FRONTEND,
  stdio: 'inherit',
  shell: false,
});
child.on('exit', (code) => {
  if (code === 0) {
    const files = fs.readdirSync(OUTDIR, { recursive: true }).filter((f) => fs.statSync(path.join(OUTDIR, f)).isFile()).length;
    console.log(`[build] done — ${files} file(s) in public/`);
  }
  process.exit(code || 0);
});