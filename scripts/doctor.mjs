/**
 * `npm run doctor` — works out why the app is not loading, from inside the
 * environment that is actually failing.
 *
 * Read-only apart from briefly starting servers on spare ports and stopping
 * them again. Run it, paste the output.
 *
 * The failure this was written for: in Codespaces, a *forwarded port with
 * nothing listening on it answers HTTP 404*. The browser then draws its own
 * "No webpage was found for the web address" page, which looks exactly like a
 * broken app but means "wrong port, or the server is not up yet".
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = 5173;
const PREVIEW_PORT = 3000;

const problems = [];
const notes = [];

const say = (s = '') => console.log(s);
const head = (s) => {
  say();
  say(`── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);
};
const ok = (s) => say(`  ✓ ${s}`);
const bad = (s) => {
  say(`  ✖ ${s}`);
  problems.push(s);
};
const warn = (s) => {
  say(`  ⚠ ${s}`);
  notes.push(s);
};
const info = (k, v) => say(`  · ${String(k).padEnd(28)} ${v}`);

const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};

/* ---------------- where the app should be opened ---------------- */

const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: FWD_DOMAIN } = process.env;
const CODESPACES = process.env.CODESPACES === 'true' || Boolean(CODESPACE_NAME);
const GITPOD = Boolean(process.env.GITPOD_WORKSPACE_ID);

const forwardedHost = (port) => {
  if (CODESPACE_NAME && FWD_DOMAIN) return `${CODESPACE_NAME}-${port}.${FWD_DOMAIN}`;
  if (process.env.GITPOD_WORKSPACE_ID && process.env.GITPOD_WORKSPACE_CLUSTER_HOST) {
    return `${port}-${process.env.GITPOD_WORKSPACE_ID}.${process.env.GITPOD_WORKSPACE_CLUSTER_HOST}`;
  }
  return null;
};

head('The URLs to open');
if (CODESPACES || GITPOD) {
  const dev = forwardedHost(DEV_PORT);
  const prev = forwardedHost(PREVIEW_PORT);
  if (dev) {
    say(`  npm run dev    →  https://${dev}/`);
    say(`  npm run serve  →  https://${prev}/`);
    say();
    say('  These are different ports. Each URL answers 404 unless that exact');
    say('  command is running right now. localhost URLs will not work at all');
    say('  from your browser — only from inside the container.');
  } else {
    warn('a cloud IDE is detected but the forwarding variables are unset, so the URLs cannot be derived.');
    info('CODESPACE_NAME', CODESPACE_NAME ?? '(unset)');
    info('forwarding domain', FWD_DOMAIN ?? '(unset)');
  }
} else {
  say(`  npm run dev    →  http://localhost:${DEV_PORT}/`);
  say(`  npm run serve  →  http://localhost:${PREVIEW_PORT}/`);
  info('cloud IDE', 'none detected (looks like a local machine)');
}

/* ---------------- what is listening right now ---------------- */

const portFree = (port) =>
  new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });

const request = (port, hostHeader, path = '/') =>
  new Promise((resolve) => {
    const req = httpGet(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: hostHeader ? { Host: hostHeader } : {},
        timeout: 10000,
      },
      (res) => {
        // keep enough to find markup well past the <head>; callers slice this
        // down themselves before printing any of it
        let body = '';
        res.on('data', (c) => {
          if (body.length < 8000) body += c.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: 'timed out' });
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
  });

head('What is listening right now');
let anyLive = false;
for (const [port, cmd] of [
  [DEV_PORT, 'npm run dev'],
  [PREVIEW_PORT, 'npm run serve'],
]) {
  if (await portFree(port)) {
    info(`port ${port}`, `nothing listening  →  its URL returns 404 until you run \`${cmd}\``);
  } else {
    anyLive = true;
    const r = await request(port);
    const host = forwardedHost(port);
    const viaFwd = host ? await request(port, host) : null;
    info(`port ${port}`, `a server is up (localhost HTTP ${r.status}${viaFwd ? `, via your forwarded hostname HTTP ${viaFwd.status}` : ''})`);
    if (viaFwd && viaFwd.status === 403) {
      bad(`port ${port} refuses your forwarded hostname (403 blocked-host). Pull the latest main — vite.config.ts needs allowedHosts.`);
    } else if (r.status === 200 && (!viaFwd || viaFwd.status === 200)) {
      ok(`port ${port} is serving correctly — open https://${host ?? `localhost:${port}`}/`);
    } else if (r.status !== 200) {
      bad(`port ${port} answered HTTP ${r.status}: ${r.body.slice(0, 160)}`);
    }
  }
}
if (!anyLive) {
  warn(
    'neither port has a server on it. If your browser is showing a 404, that is why: ' +
      'the forwarded URL exists but there is nothing behind it.',
  );
}

/* ---------------- environment ---------------- */

head('Environment');
info('node', process.version);
info('npm', sh('npm --version') || '(not found)');
info('platform', `${process.platform} ${process.arch}`);
info('cwd', ROOT);
info('CODESPACES', process.env.CODESPACES ?? '(unset)');
info('CODESPACE_NAME', CODESPACE_NAME ?? '(unset)');
info('forwarding domain', FWD_DOMAIN ?? '(unset)');

/* ---------------- repository ---------------- */

head('Repository');
info('branch', sh('git rev-parse --abbrev-ref HEAD') || '(not a git repo)');
info('commit', sh('git log -1 --format=%h\\ %s') || '(unknown)');
const dirty = sh('git status --porcelain');
info('working tree', dirty ? `${dirty.split('\n').length} modified file(s)` : 'clean');

for (const f of ['index.html', 'package.json', 'vite.config.ts', 'src/main.tsx', 'src/ui/App.tsx']) {
  if (!existsSync(join(ROOT, f))) bad(`${f} is MISSING — the app cannot build without it`);
}
ok('checked that index.html, package.json, vite.config.ts and the app entry points exist');

const viteConfig = existsSync(join(ROOT, 'vite.config.ts'))
  ? readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
  : '';
if (viteConfig.includes('allowedHosts')) ok('vite.config.ts allows forwarded hostnames');
else bad('vite.config.ts has no allowedHosts — this checkout predates the Codespaces fix. Pull main.');
if (viteConfig.includes('strictPort')) ok('vite.config.ts pins the ports, so a server cannot drift to a neighbouring port');
else warn('vite.config.ts does not set strictPort — Vite may move to another port and the forwarded URL will 404.');

const dcPath = join(ROOT, '.devcontainer', 'devcontainer.json');
if (existsSync(dcPath)) {
  const dc = readFileSync(dcPath, 'utf8');
  if (/"forwardPorts"\s*:\s*\[[^\]]*\d/.test(dc)) {
    warn(
      'devcontainer.json pre-declares forwardPorts. Codespaces then publishes those URLs at ' +
        'container start, before any server exists — and each answers 404 until you start one. ' +
        'Leaving it out lets ports forward when something actually listens.',
    );
  } else {
    ok('devcontainer.json does not pre-declare dead ports');
  }
}

/* ---------------- dependencies ---------------- */

head('Dependencies');
if (!existsSync(join(ROOT, 'node_modules'))) {
  bad('node_modules is missing — run: npm install');
} else {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const missing = Object.keys(declared).filter((d) => !existsSync(join(ROOT, 'node_modules', d)));
  if (missing.length) bad(`declared but not installed: ${missing.join(', ')} — run: npm install`);
  else ok(`all ${Object.keys(declared).length} declared packages are installed`);
}

/* ---------------- live probe: dev server ---------------- */

const bootAndProbe = async (label, args, port) => {
  head(label);
  const log = [];
  const child = spawn('npx', args, { cwd: ROOT, env: { ...process.env } });
  child.stdout.on('data', (d) => log.push(d.toString()));
  child.stderr.on('data', (d) => log.push(d.toString()));

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    const r = await request(port);
    if (r.status > 0) up = true;
    else await new Promise((r2) => setTimeout(r2, 500));
  }

  if (!up) {
    bad(`${label} never answered — it failed to start. Its output:`);
    say(
      log
        .join('')
        .split('\n')
        .map((l) => `      ${l}`)
        .join('\n')
        .slice(0, 2000),
    );
  } else {
    const local = await request(port);
    info('localhost', `HTTP ${local.status}`);
    if (local.status !== 200) bad(`${label} returned HTTP ${local.status}: ${local.body.slice(0, 160)}`);
    else ok('serves the page on localhost');

    // the real forwarded hostname for this spare port, so the host check is
    // exercised exactly as the browser would exercise it
    const host = forwardedHost(port) ?? `probe-${port}.app.github.dev`;
    const viaHost = await request(port, host);
    info('via forwarded hostname', `HTTP ${viaHost.status}  (${host})`);
    if (viaHost.status === 200) ok('accepts the forwarded hostname — the host check is not the problem');
    else if (viaHost.status === 403) bad(`refused the forwarded hostname (403): ${viaHost.body.slice(0, 200)}`);
    else bad(`forwarded hostname returned HTTP ${viaHost.status}: ${viaHost.body.slice(0, 160)}`);

    if (local.status === 200 && !/id="root"/.test(local.body)) {
      warn('the served HTML has no #root element — check index.html');
    }
  }
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
};

await bootAndProbe('Dev server probe (vite, spare port 5178)', ['vite', '--port', '5178', '--strictPort'], 5178);

/* ---------------- built output + preview probe ---------------- */

head('Built output (dist/)');
const distIndex = join(ROOT, 'dist', 'index.html');
if (!existsSync(distIndex)) {
  info('dist/index.html', 'absent — normal until you build; `npm run serve` builds first');
} else {
  const html = readFileSync(distIndex, 'utf8');
  ok(`dist/index.html present (${html.length} bytes)`);
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  if (!assets.length) warn('dist/index.html references no JS or CSS — the build looks empty');
  for (const a of assets) {
    const p = join(ROOT, 'dist', a.replace(/^\.?\//, ''));
    if (existsSync(p)) ok(`${a} exists on disk`);
    else bad(`index.html references ${a} but that file is not in dist/`);
  }
  await bootAndProbe(
    'Built-app probe (vite preview, spare port 3008)',
    ['vite', 'preview', '--port', '3008', '--strictPort'],
    3008,
  );
}

/* ---------------- verdict ---------------- */

head('Summary');
if (problems.length === 0) {
  say('  Nothing is broken inside the container: the app builds and serves, and');
  say('  the forwarded hostname is accepted.');
  say();
  if (!anyLive) {
    say('  You had no server running when this ran. That alone explains a 404:');
    say('  a forwarded Codespaces port with nothing behind it returns 404, and');
    say('  the browser draws its own "No webpage was found" page.');
    say();
    say('  Start one and open the matching URL from the list at the top:');
    say(`    npm run dev     → port ${DEV_PORT}   (hot reload, use this normally)`);
    say(`    npm run serve   → port ${PREVIEW_PORT}   (the built app)`);
  } else {
    say('  A server is up. If the browser still 404s, check in this order:');
    say('    1. Are you opening the URL for the port that is actually running?');
    say(`       ${DEV_PORT} and ${PREVIEW_PORT} are different servers, started by different commands.`);
    say('    2. Ports panel → open the port with the globe icon rather than');
    say('       typing a URL, so the hostname is guaranteed right.');
    say('    3. Hard-reload — the browser may be showing a cached error page.');
    say('    4. Port Visibility: a Private port opened from a browser profile');
    say('       not signed in to this codespace will not reach your server.');
  }
} else {
  say(`  ${problems.length} problem(s) found:`);
  for (const p of problems) say(`    ✖ ${p}`);
}
if (notes.length) {
  say();
  say('  Worth a look:');
  for (const n of notes) say(`    ⚠ ${n}`);
}
say();
process.exit(0);
