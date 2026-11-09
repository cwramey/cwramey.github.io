// Design PDF Analyzer demo: reads the <text> layer of a synthetic plan sheet, runs the engine, draws results.
import { extract, PY_PATTERNS, CSV_COLUMNS, TOL_FT } from './engine.js';
import { highlight } from '../lib/highlight.js';

const SHEETS = { 'sheet-a': 'Sheet A · Aerial', 'sheet-b': 'Sheet B · Underground' };
const KINDS = {
  station: 'Station', span: 'Span footage', structure: 'Pole / handhole', duct: 'Duct', footer: 'Footer summary',
};
const kindOf = k => (k === 'count' ? 'footer' : k);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ft = n => (n == null ? '–' : `${n.toLocaleString('en-US')} ft`);
const SVGNS = 'http://www.w3.org/2000/svg';

export async function mount(el, ctx) {
  el.innerHTML = `
    <div class="demo-ctl">
      <ol class="demo-steps"><li>Pick a sheet</li><li>Extract</li><li>Download</li></ol>
      <span class="demo-spacer"></span>
      <label class="pa-pick"><span class="pa-sr">Sample sheet</span>
        <select data-sheet-sel>${Object.entries(SHEETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </label>
      <button class="demo-btn demo-btn--primary${ctx.reduceMotion ? '' : ' demo-pulse'}" data-run>Extract</button>
      <button class="demo-btn" data-rx-btn aria-pressed="false" aria-controls="pa-rx">Show regex</button>
    </div>
    <div class="demo-split">
      <div class="demo-view pa-view">
        <ul class="pa-legend" aria-label="Highlight colours">${Object.entries(KINDS).map(([k, v]) => `<li><i class="pa-sw pa-${k}"></i>${v}</li>`).join('')}</ul>
        <div class="pa-sheet" data-sheet tabindex="0" aria-label="Plan sheet. Scroll to pan."></div>
      </div>
      <div class="demo-out">
        <p class="demo-status" aria-live="polite" data-status>Results appear here. Try Sheet B: one station label doesn't add up.</p>
        <div class="pa-rx" id="pa-rx" hidden>
          <p class="pa-h">Patterns (Python, same as production)</p>
          <pre class="demo-code" data-rx></pre>
        </div>
        <div class="pa-res" data-res hidden>
          <div class="demo-stats" data-stats></div>
          <div><p class="pa-h">Strategies · selected by agreement</p><div class="pa-methods" data-methods></div></div>
          <div class="pa-warn" data-warn></div>
          <div><p class="pa-h">Per-segment extraction · hover or focus a row to find it</p>
            <div class="pa-tablewrap"><table class="demo-table pa-segs">
              <thead><tr><th>#</th><th>From → to</th><th class="num">Label</th><th class="num">Δ STA</th><th>Status</th><th>Stations</th><th>Duct</th></tr></thead>
              <tbody data-rows></tbody>
            </table></div>
          </div>
          <details class="pa-det"><summary>Cross-checks</summary><ul class="pa-checks" data-checks></ul></details>
          <details class="pa-det" open><summary>JSON output</summary><pre class="demo-code pa-json" data-json></pre></details>
          <div class="demo-dl">
            <button class="demo-btn" data-dl="json">↓ JSON</button>
            <button class="demo-btn" data-dl="csv">↓ CSV</button>
          </div>
        </div>
      </div>
    </div>
    <p class="demo-foot">Same rules as the production tool. Synthetic data, no client information. The sheet's &lt;text&gt; nodes stand in for a PDF text layer.</p>`;

  const $ = s => el.querySelector(s);
  const steps = el.querySelectorAll('.demo-steps li');
  const step = n => steps.forEach((li, i) => li.classList.toggle('done', i < n));
  const sel = $('[data-sheet-sel]'), sheetEl = $('[data-sheet]'), status = $('[data-status]');
  const cache = {};
  let result = null, boxes = new Map(), overlay = null;

  function setStatus(msg, cls = '') { status.className = `demo-status ${cls}`; ctx.announce(status, msg); }

  async function loadSheet() {
    const key = sel.value;
    cache[key] ??= await (await fetch(ctx.asset(`${key}.svg`))).text();
    sheetEl.innerHTML = cache[key]; // committed same-origin file, presentation attributes only
    result = null; boxes = new Map(); overlay = null;
    $('[data-res]').hidden = true;
    renderRegex();
  }

  function textLayer() {
    return [...sheetEl.querySelectorAll('svg text')].map((n, id) => {
      const b = n.getBBox();
      return { id, text: n.textContent, x: b.x, y: b.y + b.height * 0.8, w: b.width, h: b.height, node: n };
    });
  }

  function drawBoxes(labels, hits) {
    const svg = sheetEl.querySelector('svg');
    overlay = document.createElementNS(SVGNS, 'g');
    overlay.setAttribute('class', 'pa-overlay');
    let i = 0;
    for (const h of hits) {
      for (const id of h.ids) {
        const l = labels[id], b = l.node.getBBox();
        const r = document.createElementNS(SVGNS, 'rect');
        Object.entries({ x: b.x - 3, y: b.y - 2, width: b.width + 6, height: b.height + 4, rx: 2 }).forEach(([k, v]) => r.setAttribute(k, v.toFixed?.(1) ?? v));
        r.setAttribute('class', `pa-box pa-${kindOf(h.kind)}${ctx.reduceMotion ? '' : ' pa-anim'}`);
        if (!ctx.reduceMotion) r.style.animationDelay = `${Math.min(i++ * 14, 700)}ms`;
        r.dataset.id = id;
        const t = document.createElementNS(SVGNS, 'title');
        t.textContent = `${KINDS[kindOf(h.kind)]}: ${h.match}`;
        r.append(t);
        overlay.append(r);
        if (!boxes.has(id)) boxes.set(id, []);
        boxes.get(id).push(r);
      }
    }
    svg.append(overlay);
  }

  function spotlight(ids, on) {
    if (!overlay) return;
    overlay.classList.toggle('spot', on);
    overlay.querySelectorAll('.on').forEach(r => r.classList.remove('on'));
    if (on) ids.forEach(id => boxes.get(id)?.forEach(r => r.classList.add('on')));
  }

  function panTo(ids) {
    const r = boxes.get(ids[0])?.[0];
    if (!r || sheetEl.scrollWidth <= sheetEl.clientWidth) return;
    const a = r.getBoundingClientRect(), c = sheetEl.getBoundingClientRect();
    sheetEl.scrollLeft += a.left - c.left - c.width / 2 + a.width / 2;
  }

  function renderRegex() {
    const counts = result?.matches ?? {};
    const name = { station: 'STATION', span: 'SPAN', structure: 'STRUCTURE', duct: 'DUCT', footer: 'FOOTER_TOTAL', count: 'FOOTER_COUNT' };
    const code = `import re\n\n` + Object.entries(PY_PATTERNS).map(([k, p]) =>
      `${(name[k]).padEnd(12)} = re.compile(r"""${p}""")${result ? `  # ${counts[k] ?? 0} hits` : ''}`).join('\n') +
      `\n\n# Footer patterns run on rebuilt lines (cells joined on a shared baseline).\n# Two strategies agree when within ${TOL_FT} ft.`;
    $('[data-rx]').innerHTML = highlight(code, 'python');
  }

  function render(ms) {
    const r = result, t = r.totals, sheet = SHEETS[sel.value];
    $('[data-stats]').innerHTML = [
      ['Route', ft(t.routeFt)], ['Aerial', ft(t.aerialFt)], ['UG', ft(t.ugFt)],
      ['Poles', t.poles], ['Handholes', t.handholes], ['Ducts', t.ducts], ['Parsed in', `${ms.toFixed(1)} ms`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

    $('[data-methods]').innerHTML = r.methods.map(m => `
      <div class="pa-method${m.key === r.method.selected ? ' sel' : ''}">
        <div class="pa-mhead"><b>${m.name}</b>${m.key === r.method.selected ? '<span class="pa-pick-tag">✓ selected</span>' : ''}</div>
        <div class="pa-mval">${ft(m.ft)}</div>
        <div class="pa-mmeta">${esc(m.detail)}</div>
        <div class="pa-mmeta"><span class="demo-badge demo-badge--${m.level}">${Math.round(m.confidence * 100)}% ${m.level === 'med' ? 'medium' : m.level}</span>
          ${m.agrees.length ? `agrees with ${m.agrees.length}` : 'agrees with none'}</div>
      </div>`).join('');

    $('[data-warn]').innerHTML = r.warnings.length
      ? r.warnings.map(w => `<div class="demo-callout" role="note">⚠ ${esc(w)}</div>`).join('')
      : `<div class="demo-callout demo-callout--ok">✓ Labels, station chain and footer agree within ${TOL_FT} ft. Counts match the footer.</div>`;

    $('[data-rows]').innerHTML = r.segments.map((s, i) => `
      <tr tabindex="0" data-i="${i}" class="${s.status === 'mismatch' ? 'pa-bad' : ''}">
        <td>${s.seg}</td><td>${esc(s.from ?? '?')} → ${esc(s.to ?? '?')}</td>
        <td class="num">${s.labelFt ?? '–'}' ${esc(s.type ?? '')}</td>
        <td class="num">${s.stationFt ?? '–'}${s.diffFt ? ` <em>(${s.diffFt > 0 ? '+' : ''}${s.diffFt})</em>` : ''}</td>
        <td><span class="demo-badge demo-badge--${s.status === 'ok' ? 'low' : 'high'}">${s.status}</span></td>
        <td class="pa-sta">${esc(s.staFrom?.slice(4) ?? '?')} → ${esc(s.staTo?.slice(4) ?? '?')}</td>
        <td>${esc(s.duct ?? '–')}</td>
      </tr>`).join('');

    $('[data-checks]').innerHTML = r.checks.map(c =>
      `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '⚠'} ${esc(c.check)}: expected ${esc(c.expected)}, found ${esc(c.found)}</li>`).join('');

    const { hits, ...shown } = exportObj(ms);
    $('[data-json]').innerHTML = highlight(JSON.stringify({ ...shown, hits: `[${hits.length} matches, full list in the download]` }, null, 2), 'json');
    $('[data-res]').hidden = false;
    renderRegex();
    const n = r.warnings.length;
    setStatus(`✓ ${r.hits.length} matches on ${sheet} in ${ms.toFixed(1)} ms. ${r.method.name}: ${ft(t.routeFt)}, ${Math.round(r.method.confidence * 100)}% confidence.${n ? ` ⚠ ${n} warning${n > 1 ? 's' : ''}.` : ' No warnings.'}`, n ? 'warn' : 'ok');
  }

  const exportObj = ms => ({
    tool: 'design-pdf-analyzer (demo)', sheet: sel.value, title: SHEETS[sel.value], parsedMs: +ms.toFixed(2),
    method: result.method, totals: result.totals, methods: result.methods, footer: result.footer,
    segments: result.segments.map(({ refs, ...s }) => s), structures: result.structures,
    checks: result.checks, warnings: result.warnings, matches: result.matches,
    hits: result.hits.map(({ id, kind, match }) => ({ id, kind, match })),
  });
  let lastMs = 0;

  function run() {
    $('[data-run]').classList.remove('demo-pulse');
    sheetEl.querySelector('.pa-overlay')?.remove();
    boxes = new Map();
    const t0 = performance.now();
    const labels = textLayer();
    result = extract(labels);
    lastMs = performance.now() - t0;
    drawBoxes(labels, result.hits);
    render(lastMs);
    step(2);
  }

  // Events
  sel.addEventListener('change', async () => { step(1); await loadSheet(); setStatus(`${SHEETS[sel.value]} loaded. Press Extract.`); });
  $('[data-run]').addEventListener('click', run);
  $('[data-rx-btn]').addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Hide regex' : 'Show regex';
    $('#pa-rx').hidden = !on;
  });
  el.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => {
    if (!result) return;
    const name = `${sel.value}-extract`;
    if (b.dataset.dl === 'json') ctx.saveText(`${name}.json`, JSON.stringify(exportObj(lastMs), null, 2), 'application/json');
    else ctx.saveText(`${name}.csv`, ctx.toCSV(result.segments, CSV_COLUMNS), 'text/csv');
    step(3);
    ctx.toast(`Saved ${name}.${b.dataset.dl}`);
  }));

  const rows = $('[data-rows]');
  const rowOf = e => e.target.closest?.('tr[data-i]');
  const refsOf = tr => result?.segments[+tr.dataset.i]?.refs ?? [];
  const enter = e => { const tr = rowOf(e); if (tr) { spotlight(refsOf(tr), true); tr.classList.add('sel'); } };
  const leave = e => { const tr = rowOf(e); if (tr) { spotlight([], false); tr.classList.remove('sel'); } };
  rows.addEventListener('mouseover', enter);
  rows.addEventListener('mouseout', leave);
  rows.addEventListener('focusin', e => { enter(e); const tr = rowOf(e); if (tr) panTo(refsOf(tr)); });
  rows.addEventListener('focusout', leave);
  rows.addEventListener('click', e => { const tr = rowOf(e); if (tr) panTo(refsOf(tr)); });

  // Hovering a box on the sheet highlights the segment rows that use it.
  sheetEl.addEventListener('mouseover', e => {
    const id = e.target.dataset?.id;
    if (id == null || !result) return;
    rows.querySelectorAll('tr').forEach(tr => tr.classList.toggle('sel', refsOf(tr).includes(+id)));
  });
  sheetEl.addEventListener('mouseout', e => { if (e.target.dataset?.id != null) rows.querySelectorAll('tr.sel').forEach(tr => tr.classList.remove('sel')); });

  await loadSheet();
}
