// Fiber Route Conflict Analyzer: live demo view (DOM + SVG). Logic lives in engine.js.
import { analyze, exportGeoJSON, exportCSV, exportMarkdown, exportKML } from './engine.js';
import { toPath } from '../lib/geom.js';

const NS = 'http://www.w3.org/2000/svg';
const RISK_CLS = { High: 'high', Medium: 'med', Low: 'low' };
const fmt = n => Math.round(n).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function svgEl(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}
const title = (node, text) => (svgEl('title', {}, node).textContent = text, node);

export async function mount(el, ctx) {
  const data = await ctx.json('data.json');
  const [W, H] = data.extent;
  const layerOn = new Set(data.layers.map(l => l.id));
  let current = data.routes.find(r => r.id === 'B');
  let draft = null, result = null, selected = null;

  el.innerHTML = `
    <div class="demo-ctl"><ol class="demo-steps">
      <li data-step="1">Pick a route</li><li data-step="2">Run analysis</li><li data-step="3">Download the permit report</li>
    </ol></div>
    <div class="demo-ctl fr-routes" role="group" aria-label="Route">
      ${data.routes.map(r => `<button type="button" class="demo-btn" data-route="${r.id}" aria-pressed="false">${esc(r.name)}</button>`).join('')}
      <button type="button" class="demo-btn" data-draw aria-pressed="false">✎ Draw your own</button>
      <span class="fr-drawctl" hidden>
        <button type="button" class="demo-btn" data-undo>Undo point</button>
        <button type="button" class="demo-btn demo-btn--primary" data-done disabled>Done</button>
        <button type="button" class="demo-btn" data-cancel>Cancel</button>
      </span>
      <span class="demo-spacer"></span>
      <button type="button" class="demo-btn demo-btn--primary" data-run>▶ Run analysis</button>
    </div>
    <fieldset class="demo-ctl fr-layers"><legend>Reference layers</legend>
      ${data.layers.map(l => `<label class="demo-chk"><input type="checkbox" data-layer="${l.id}" checked><i class="fr-sw fr-sw--${l.id}"></i>${esc(l.label)}</label>`).join('')}
    </fieldset>
    <div class="demo-split">
      <div class="demo-view">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sample map in local feet with reference layers and the proposed fiber route"></svg>
        <p class="fr-hint" hidden>Click or tap the map to add vertices, then press Done (or double-click).</p>
      </div>
      <div class="demo-out">
        <p class="demo-status" aria-live="polite"></p>
        <div class="demo-stats" hidden></div>
        <div class="fr-quality"></div>
        <div class="fr-table" hidden>
          <p class="fr-cap" id="fr-cap">Permit corridors. Select a row to highlight it on the map.</p>
          <div class="fr-scroll"><table class="demo-table" aria-describedby="fr-cap">
            <thead><tr><th>ID</th><th>Permit</th><th>Risk</th><th>Owner</th><th class="num">Conf.</th></tr></thead><tbody></tbody></table></div>
        </div>
        <div class="demo-dl" role="group" aria-label="Downloads">
          <button type="button" class="demo-btn" data-dl="geojson" disabled>⇩ GeoJSON</button>
          <button type="button" class="demo-btn" data-dl="csv" disabled>⇩ CSV</button>
          <button type="button" class="demo-btn" data-dl="md" disabled>⇩ Permit summary .md</button>
          <button type="button" class="demo-btn" data-dl="kml" disabled>⇩ KML</button>
        </div>
      </div>
    </div>
    <p class="demo-foot">Same rules as the production tool. Synthetic data, no client information.</p>`;

  const $ = s => el.querySelector(s), $$ = s => [...el.querySelectorAll(s)];
  const svg = $('svg'), status = $('.demo-status'), runBtn = $('[data-run]');
  const say = msg => ctx.announce(status, msg);
  const step = (n, on) => $(`[data-step="${n}"]`).classList.toggle('done', on);

  // ---- Static map ------------------------------------------------------------------------------------------
  const defs = svgEl('defs', {}, svg);
  const pat = svgEl('pattern', { id: 'fr-grid', width: 200, height: 200, patternUnits: 'userSpaceOnUse' }, defs);
  svgEl('path', { d: 'M200 0H0V200', class: 'fr-gridline' }, pat);
  svgEl('rect', { width: W, height: H, fill: 'url(#fr-grid)' }, svg);
  const groups = {};
  for (const l of data.layers) {
    const g = groups[l.id] = svgEl('g', { class: `fr-l fr-l--${l.id}` }, svg);
    for (const f of l.features) {
      const tip = `${f.name ?? f.id} · ${f.owner ?? 'owner missing'}${f.jurisdiction ? ` · ${f.jurisdiction}` : ''} · edited ${l.lastEdit}`;
      if (l.kind === 'line') {
        const cls = `fr-f fr-f--${f.cls ?? l.cls}${f.owner ? '' : ' fr-f--noowner'}`;
        if (l.id === 'rail') svgEl('path', { d: toPath(f.coords), class: 'fr-ties' }, g);
        title(svgEl('path', { d: toPath(f.coords), class: cls }, g), tip);
      } else {
        title(svgEl('path', { d: toPath(f.ring) + 'Z', class: 'fr-poly' }, g), tip);
        if (l.kind === 'zones') svgEl('text', { x: f.ring[0][0] + 50, y: f.ring[0][1] + 110, class: 'fr-zlbl' }, g).textContent = `${f.id} · ${f.owner ?? 'owner ?'}`;
      }
    }
  }
  svgEl('path', { d: toPath(data.cityLimit), class: 'fr-limit' }, groups.parcels);
  const label = (g, x, y, t, rot = 0) => (svgEl('text', { x, y, class: 'fr-lbl', transform: rot ? `rotate(${rot} ${x} ${y})` : '' }, groups[g]).textContent = t);
  label('dot', 60, 1460, 'SR-14 (DOT)'); label('water', 3010, 330, 'Mill River', 72); label('rail', 300, 2700, 'Coastline Rail', -24.6);
  label('pipeline', 3000, 2520, 'Line 7 gas', -14); label('roads', 3430, 2900, 'CR-210'); label('roads', 820, 2900, 'Oak');
  label('roads', 1720, 2900, 'Elm'); label('roads', 60, 870, 'Main St'); label('rail', 4000, 1180, 'Yard spur', 42);
  label('parcels', 2200, 2960, 'City │ County');

  const gCorr = svgEl('g', { class: 'fr-corr' }, svg);
  const gRoute = svgEl('g', {}, svg);
  const gMark = svgEl('g', {}, svg);

  // ---- Route drawing -----------------------------------------------------------------------------------------
  function drawRoute(pts, cls = 'fr-route') {
    gRoute.innerHTML = '';
    if (pts.length < 1) return;
    const p = svgEl('path', { d: toPath(pts), class: cls }, gRoute);
    pts.forEach((v, i) => svgEl('circle', { cx: v[0], cy: v[1], r: i === 0 || i === pts.length - 1 ? 48 : 30, class: 'fr-vtx' }, gRoute));
    return p;
  }

  function clearResults(msg) {
    result = null; selected = null;
    gCorr.innerHTML = gMark.innerHTML = '';
    $('.demo-stats').hidden = $('.fr-table').hidden = true;
    $('.fr-quality').innerHTML = '';
    $$('[data-dl]').forEach(b => (b.disabled = true));
    step(2, false); step(3, false);
    if (msg) say(msg);
  }

  function pickRoute(r) {
    current = r; endDraw(false);
    $$('[data-route]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.route === r.id)));
    drawRoute(r.coords); step(1, true); runBtn.disabled = false;
    clearResults(`${r.name} selected. Press Run analysis.`);
  }

  // ---- Draw your own -------------------------------------------------------------------------------------------
  const toLocal = e => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return [Math.round(Math.max(0, Math.min(W, pt.x))), Math.round(Math.max(0, Math.min(H, pt.y)))];
  };
  function startDraw() {
    draft = []; clearResults();
    $$('[data-route]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    $('[data-draw]').setAttribute('aria-pressed', 'true');
    $('.fr-drawctl').hidden = $('.fr-hint').hidden = false;
    svg.classList.add('fr-drawing'); gRoute.innerHTML = ''; runBtn.disabled = true; step(1, false);
    say('Drawing: click or tap the map to add vertices, then press Done.');
  }
  function endDraw(keep) {
    if (!draft) return;
    const pts = draft; draft = null;
    $('[data-draw]').setAttribute('aria-pressed', 'false');
    $('.fr-drawctl').hidden = $('.fr-hint').hidden = true;
    svg.classList.remove('fr-drawing');
    if (keep) pickRoute({ id: 'custom', name: 'Custom route', coords: pts });
  }
  function updateDraft() {
    drawRoute(draft, 'fr-route fr-route--draft');
    $('[data-done]').disabled = draft.length < 2;
  }
  svg.addEventListener('click', e => {
    if (!draft) return;
    const p = toLocal(e), last = draft.at(-1);
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 40) return;
    draft.push(p); updateDraft();
    say(`Vertex ${draft.length} at ${fmt(p[0])}, ${fmt(p[1])} ft.`);
  });
  svg.addEventListener('dblclick', () => { if (draft?.length >= 2) endDraw(true); });
  $('[data-draw]').addEventListener('click', () => (draft ? endDraw(false) : startDraw()));
  $('[data-undo]').addEventListener('click', () => { draft.pop(); updateDraft(); });
  $('[data-done]').addEventListener('click', () => endDraw(true));
  $('[data-cancel]').addEventListener('click', () => { endDraw(false); pickRoute(current); });
  $$('[data-route]').forEach(b => b.addEventListener('click', () => pickRoute(data.routes.find(r => r.id === b.dataset.route))));

  // ---- Layers --------------------------------------------------------------------------------------------------
  $$('[data-layer]').forEach(cb => cb.addEventListener('change', () => {
    const id = cb.dataset.layer;
    cb.checked ? layerOn.add(id) : layerOn.delete(id);
    groups[id].style.display = cb.checked ? '' : 'none';
    if (result) clearResults(`${cb.checked ? 'Added' : 'Removed'} ${cb.parentNode.textContent.trim()}. Run analysis again.`);
  }));

  // ---- Analysis + output -------------------------------------------------------------------------------------
  function run() {
    if (draft) return;
    clearResults();
    result = analyze(data, current.coords, layerOn);
    const { stats: s, corridors, crossings, quality } = result;
    const motion = !ctx.reduceMotion;

    const route = drawRoute(current.coords);
    if (motion && route) {
      const L = route.getTotalLength();
      route.style.strokeDasharray = L; route.style.strokeDashoffset = L;
      route.getBoundingClientRect();
      route.style.transition = 'stroke-dashoffset .7s ease-out'; route.style.strokeDashoffset = 0;
    }
    corridors.forEach(k => {
      const p = title(svgEl('path', { d: toPath(k.geometry), class: `fr-buf fr-buf--${RISK_CLS[k.risk]}`, 'data-id': k.id }, gCorr), `${k.id} · ${k.permit}`);
      p.addEventListener('click', () => select(k.id, true));
    });
    crossings.forEach((c, i) => {
      const g = svgEl('g', { class: `fr-mk fr-mk--${RISK_CLS[c.risk]}${motion ? ' fr-pop' : ''}`, 'data-corr': c.corridor }, gMark);
      if (motion) g.style.animationDelay = `${0.5 + i * 0.07}s`;
      svgEl('circle', { cx: c.point[0], cy: c.point[1], r: 62 }, g);
      title(g, `${c.id} ${c.name} · ${c.risk} · ${c.owner ?? 'owner missing'} · conf ${c.confidence.toFixed(2)}`);
    });

    $('.demo-stats').innerHTML = `
      <div><span>Length</span><b>${fmt(s.lengthFt)} ft</b><small>${s.lengthMi} mi</small></div>
      <div><span>Crossings</span><b>${s.crossings}</b><small><em class="r-high">${s.byRisk.High} H</em> · <em class="r-med">${s.byRisk.Medium} M</em> · <em class="r-low">${s.byRisk.Low} L</em></small></div>
      <div><span>Permits</span><b>${s.permits}</b><small>corridors</small></div>
      <div><span>Confidence</span><b>${s.confidence.toFixed(2)}</b><small>mean</small></div>`;
    $('.demo-stats').hidden = false;

    $('.fr-quality').innerHTML = quality.length
      ? `<div class="demo-callout"><b>Data quality</b><ul>${quality.map(q => `<li>${esc(q.text)}</li>`).join('')}</ul></div>`
      : `<div class="demo-callout demo-callout--ok"><b>Data quality</b><br>All contributing layers are current and attributed.</div>`;

    $('tbody').innerHTML = corridors.length ? corridors.map(k => `
      <tr tabindex="0" data-id="${k.id}" aria-selected="false">
        <td>${k.id}</td><td>${esc(k.permit)}<br><small>${k.features.map(esc).join(', ')}</small></td>
        <td><span class="demo-badge demo-badge--${RISK_CLS[k.risk]}">${k.risk}</span></td>
        <td>${k.owner ? esc(k.owner) : '<b class="fr-miss">owner missing</b>'}<br><small>${esc(k.jurisdiction)}</small></td>
        <td class="num${k.confidence < 1 ? ' fr-low' : ''}" title="${esc(k.penalties.map(p => p.label).join('; '))}">${k.confidence.toFixed(2)}</td>
      </tr>`).join('') : '<tr><td colspan="5">No crossings: this route needs no permits.</td></tr>';
    $('.fr-table').hidden = false;
    $$('[data-dl]').forEach(b => (b.disabled = false));
    step(2, true);
    say(`${current.name}: ${s.crossings} crossings (${s.byRisk.High} high risk), ${s.permits} permit${s.permits === 1 ? '' : 's'}, ${fmt(s.lengthFt)} ft.${quality.length ? ` ${quality.length} data-quality note${quality.length === 1 ? '' : 's'}.` : ''}`);
  }

  function select(id, fromMap) {
    selected = selected === id ? null : id;
    gCorr.classList.toggle('has-sel', !!selected);
    gMark.classList.toggle('has-sel', !!selected);
    $$('.fr-buf').forEach(p => p.classList.toggle('on', p.dataset.id === selected));
    $$('.fr-mk').forEach(g => g.classList.toggle('on', g.dataset.corr === selected));
    $$('tbody tr[data-id]').forEach(tr => {
      const on = tr.dataset.id === selected;
      tr.classList.toggle('sel', on); tr.setAttribute('aria-selected', String(on));
      if (on && fromMap) tr.scrollIntoView({ block: 'nearest', behavior: ctx.reduceMotion ? 'auto' : 'smooth' });
    });
    const k = result?.corridors.find(c => c.id === selected);
    if (k) say(`${k.id}: ${k.permit}, ${k.risk} risk, ${k.owner ?? 'owner missing'}, ${k.jurisdiction}, stations ${fmt(k.from)} to ${fmt(k.to)} ft, confidence ${k.confidence.toFixed(2)}.`);
  }
  $('tbody').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id); });
  $('tbody').addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(tr.dataset.id); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling)?.focus(); }
  });
  runBtn.addEventListener('click', () => { runBtn.classList.remove('demo-pulse'); run(); });

  // ---- Downloads -----------------------------------------------------------------------------------------------
  const files = {
    geojson: () => ['route-conflicts.geojson', exportGeoJSON(data, current.name, current.coords, result), 'application/geo+json'],
    csv: () => ['permit-corridors.csv', exportCSV(result), 'text/csv'],
    md: () => ['permit-summary.md', exportMarkdown(data, current.name, result), 'text/markdown'],
    kml: () => ['route-conflicts.kml', exportKML(data, current.name, current.coords, result), 'application/vnd.google-earth.kml+xml'],
  };
  $$('[data-dl]').forEach(b => b.addEventListener('click', () => {
    if (!result) return;
    const [name, text, mime] = files[b.dataset.dl]();
    ctx.saveText(name, text, mime);
    step(3, true);
    ctx.toast(`Saved ${name} (generated in your browser).`);
    say(`Downloaded ${name}.`);
  }));

  pickRoute(current);
  if (!ctx.reduceMotion) runBtn.classList.add('demo-pulse');
}
