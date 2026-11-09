// Captures portfolio screenshots from the embedded demos.
//
//   node tools/capture-demos.mjs            # all apps
//   node tools/capture-demos.mjs canvas     # one app (key from APPS below)
//
// Starts its own static server, drives a headless Chrome/Edge over the DevTools protocol
// (no npm packages), runs each scripted state and writes
// assets/screenshots/demos/<app>/<nn>-<name>.webp. Reduced motion is emulated so every
// animation lands on its final frame and the output is the same on every run.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765, DEBUG_PORT = 9333;
const WIDTH = 1360, SCALE = 1.5;

// ---- Scripted states --------------------------------------------------------------------
// `run` is evaluated in the page (helpers on window.H). `target` is the element to capture.
const APPS = {
  'fiber-route': {
    page: 'fiber-route-analyzer.html',
    shots: [
      { name: 'overview', run: `await H.click('[data-route="B"]'); await H.click('[data-run]');` },
      { name: 'pick-route', run: `await H.click('[data-route="A"]');` },
      { name: 'corridor-detail', run: `await H.click('[data-route="B"]'); await H.click('[data-run]'); await H.click('tbody tr[data-id]:nth-child(2)');` },
      { name: 'rail-yard', run: `await H.click('[data-route="C"]'); await H.click('[data-run]');` },
      { name: 'layer-toggles', run: `await H.click('[data-route="B"]'); for (const id of ['parcels','pipelines','pipeline']) await H.uncheck('[data-layer="'+id+'"]'); await H.click('[data-run]');` },
    ],
  },
  canvas: {
    page: 'canvas-network-design.html',
    shots: [
      { name: 'overview', run: `` },
      { name: 'fiber-trace', run: `await H.click('button[data-tab="trace"]'); await H.click('[data-trace]');` },
      { name: 'bill-of-materials', run: `await H.click('[data-act="bom"]'); await H.click('button[data-tab="bom"]');` },
      { name: 'qc-blocker', run: `await H.click('[data-act="qc"]'); await H.click('button[data-tab="qc"]');` },
      { name: 'qc-cleared-submit', run: `await H.click('[data-act="auto"]'); await H.click('[data-act="qc"]'); await H.click('button[data-tab="qc"]');` },
    ],
  },
  node: {
    page: 'node-crew-tracking.html',
    shots: [
      { name: 'overview', run: `await H.range('input[type=range]', 12.5 * 60);` },
      { name: 'region-filter', run: `await H.range('input[type=range]', 14 * 60); await H.select('[data-a="region"]', 'east');` },
      { name: 'crew-timeline', css: '.demo[data-demo=node] .demo-out{max-height:none}', run: `await H.range('input[type=range]', 15 * 60); await H.click('.nd-card:nth-child(2)');` },
      { name: 'crew-message', css: '.demo[data-demo=node] .demo-out{max-height:none}', run: `await H.range('input[type=range]', 15.5 * 60); await H.click('.nd-card:nth-child(4)'); await H.click('[data-a="send"]'); await H.wait(3600);` },
      { name: 'end-of-day', run: `await H.range('input[type=range]', 18.75 * 60);` },
    ],
  },
  'arcpy-qa': {
    page: 'arcpy-reporting-qa.html',
    shots: [
      { name: 'overview', run: `await H.clickText('button', /run suite/i); await H.wait(600);` },
      { name: 'config-profile', run: `` },
      { name: 'osp-monthly-run', run: `await H.select('select[aria-label="Config profile"]', 'osp_monthly.yaml'); await H.clickText('button', /run suite/i); await H.wait(600);` },
      { name: 'map-export-layout', target: '.demo svg', pad: 24, run: `await H.clickText('button', /run suite/i); await H.wait(600);` },
      { name: 'qa-findings', target: '.demo table', pad: 24, run: `await H.clickText('button', /run suite/i); await H.wait(600); await H.click('tbody tr[data-i]');` },
    ],
  },
  'pdf-analyzer': {
    page: 'design-pdf-analyzer.html',
    shots: [
      { name: 'overview', run: `await H.click('[data-run]');` },
      { name: 'plan-sheet', run: `` },
      { name: 'mismatch-warning', run: `await H.select('[data-sheet-sel]', 1); await H.wait(400); await H.click('[data-run]');` },
      { name: 'regex-patterns', run: `await H.click('[data-run]'); await H.click('[data-rx-btn]');` },
      { name: 'segment-spotlight', run: `await H.select('[data-sheet-sel]', 1); await H.wait(400); await H.click('[data-run]'); await H.reveal('tbody tr.pa-bad'); await H.click('tbody tr.pa-bad'); H.q('tbody tr.pa-bad')?.focus({preventScroll:true}); H.q('tbody tr.pa-bad')?.dispatchEvent(new MouseEvent('mouseover', {bubbles:true})); await H.wait(400);` },
    ],
  },
  'gdb-schema': {
    page: 'arcgis-gdb-schema-tool.html',
    shots: [
      { name: 'overview', run: `` },
      { name: 'edit-feature-class', run: `await H.click('.gdb-card[data-ci="1"]');` },
      { name: 'live-validation', run: `await H.click('.gdb-card[data-ci="0"]'); await H.click('[data-act="add"]'); await H.typeLast('input[aria-label$=" name"]', '1st_Name');` },
      { name: 'generated-arcpy', run: `await H.click('[data-act="gen"]');` },
      { name: 'small-cell-preset', run: `await H.select('[data-act="preset"]', 1); await H.wait(300); await H.click('[data-act="gen"]');` },
    ],
  },
};

// ---- In-page helpers ----------------------------------------------------------------------
const HELPERS = `
window.H = {
  wait: ms => new Promise(r => setTimeout(r, ms)),
  q(sel) { return document.querySelector('.demo').querySelector(sel); },
  async click(sel) { const e = this.q(sel); if (!e) return false; e.scrollIntoView?.({block:'nearest'}); e.dispatchEvent(new MouseEvent('click', {bubbles:true})); await this.wait(350); return true; },
  async clickText(tag, re) { const e = [...document.querySelector('.demo').querySelectorAll(tag)].find(b => re.test(b.textContent)); if (e) { e.click(); await this.wait(350); } return !!e; },
  async reveal(sel) { const e = this.q(sel); if (!e) return; let p = e.parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) { p.scrollTop += e.getBoundingClientRect().top - p.getBoundingClientRect().top - 12; break; } p = p.parentElement; } await this.wait(200); },
  async uncheck(sel) { const e = this.q(sel); if (e && e.checked) { e.checked = false; e.dispatchEvent(new Event('change', {bubbles:true})); await this.wait(200); } },
  async select(sel, v) { const e = this.q(sel); if (!e) return; if (typeof v === 'number') e.selectedIndex = v; else e.value = v; e.dispatchEvent(new Event('change', {bubbles:true})); await this.wait(350); },
  async range(sel, v) { const e = this.q(sel); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); await this.wait(350); },
  async typeLast(sel, text) { const all = document.querySelector('.demo').querySelectorAll(sel); const e = all[all.length - 1]; if (!e) return; e.focus(); e.value = text; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); await this.wait(350); },
};`;

// ---- Plumbing -----------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  const hit = c.find(p => existsSync(p));
  if (!hit) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  return hit;
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, close: () => ws.close() };
}

async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function main() {
  const only = process.argv[2];
  const apps = Object.entries(APPS).filter(([k]) => !only || k === only);
  if (!apps.length) throw new Error(`Unknown app "${only}". Options: ${Object.keys(APPS).join(', ')}`);

  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const profile = mkdtempSync(join(tmpdir(), 'capture-demos-'));
  const browser = spawn(findBrowser(), [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === 'page'); }
      catch { await sleep(200); }
    }
    if (!target) throw new Error('Browser did not start.');
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: SCALE, mobile: false });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    for (const [key, app] of apps) {
      const outDir = join(ROOT, 'assets/screenshots/demos', key);
      mkdirSync(outDir, { recursive: true });
      for (const [i, shot] of app.shots.entries()) {
        // Fresh page per shot so states never leak into each other.
        await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${app.page}?capture=${Date.now()}#demo` });
        await sleep(400);
        for (let t = 0; t < 40; t++) {
          if (await evaluate(c, `!!document.querySelector('.demo .demo-foot')`)) break;
          await sleep(150);
        }
        await evaluate(c, `${HELPERS}; document.fonts.ready.then(() => true)`);
        await evaluate(c, `(() => { const s = document.createElement('style'); s.textContent = '.site-header{display:none!important} .demo-pulse{animation:none!important} *{caret-color:transparent!important}'; document.head.append(s); })()`);
        if (shot.css) await evaluate(c, `document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(shot.css)} }))`);
        if (shot.run) await evaluate(c, `(async () => { ${shot.run} })()`);
        await sleep(500);
        const rect = await evaluate(c, `(() => {
          const el = document.querySelector(${JSON.stringify(shot.target || '.demo .demo-frame')});
          if (!el) return null;
          el.scrollIntoView({ block: 'start' });
          const r = el.getBoundingClientRect(), p = ${shot.pad || 0};
          return { x: Math.max(0, r.left + scrollX - p), y: Math.max(0, r.top + scrollY - p), width: r.width + 2 * p, height: r.height + 2 * p };
        })()`);
        if (!rect) { console.warn(`  ! ${key}/${shot.name}: target not found, skipped`); continue; }
        await sleep(250);
        const { data } = await c.send('Page.captureScreenshot', { format: 'webp', quality: 88, captureBeyondViewport: true, clip: { ...rect, scale: 1 } });
        const file = join(outDir, `${String(i + 1).padStart(2, '0')}-${shot.name}.webp`);
        writeFileSync(file, Buffer.from(data, 'base64'));
        console.log(`  ✓ ${key}/${String(i + 1).padStart(2, '0')}-${shot.name}.webp  ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      }
    }
    c.close();
  } finally {
    browser.kill(); server.kill();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
