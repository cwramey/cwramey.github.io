// ArcGIS GDB Schema Tool demo: node graph + field editor + live validation + ArcPy generator.
import { highlight } from '../lib/highlight.js';
import { FIELD_TYPES, validate, errorCount, generate, toSchemaJSON, uniqueFieldName, relationshipKeys, slug } from './engine.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : w.endsWith('s') ? 'es' : 's'}`;

// Graph geometry (SVG user units)
const CW = 190, HEAD = 34, ROW = 19, PAD = 8, GX = 56, GY = 26, M = 14, LOOP = 46;

function layout(classes, cols) {
  const colY = Array(cols).fill(M);
  return classes.map((c, i) => {
    const col = i % cols, h = HEAD + c.fields.length * ROW + PAD;
    const box = { x: M + col * (CW + GX), y: colY[col], h, col };
    colY[col] += h + GY;
    return box;
  });
}

export async function mount(el, ctx) {
  const presets = await ctx.json('presets.json');
  el.innerHTML = `
  <div class="demo-ctl">
    <ol class="demo-steps"><li data-step="1">Load a preset</li><li data-step="2">Add or edit a field</li><li data-step="3">Generate ArcPy</li></ol>
    <span class="demo-spacer"></span>
    <label class="gdb-lbl">Preset <select data-act="preset">${Object.entries(presets).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select></label>
    <button class="demo-btn" data-act="reset" type="button">Reset</button>
    <button class="demo-btn demo-btn--primary" data-act="gen" type="button">Generate ArcPy</button>
  </div>
  <p class="demo-status gdb-status" aria-live="polite"></p>
  <div class="demo-split">
    <div class="demo-view gdb-view" aria-label="Feature class graph"></div>
    <div class="demo-out gdb-ed"></div>
  </div>
  <div class="gdb-bottom">
    <section class="gdb-val" aria-labelledby="gdb-val-h"><h4 id="gdb-val-h">Validation</h4><ul class="gdb-issues"></ul></section>
    <section class="gdb-codebox" aria-labelledby="gdb-code-h">
      <div class="gdb-codehead"><h4 id="gdb-code-h">build_.py</h4>
        <div class="demo-dl">
          <button class="demo-btn" data-act="copy" type="button" disabled>Copy</button>
          <button class="demo-btn" data-act="dlpy" type="button" disabled>Download .py</button>
          <button class="demo-btn" data-act="dljson" type="button">Download schema.json</button>
        </div>
      </div>
      <div class="gdb-gate"></div>
      <pre class="demo-code gdb-code"><code></code></pre>
    </section>
  </div>
  <p class="demo-foot">Same rules as the production tool. Synthetic data, no client information.</p>`;

  const $ = s => el.querySelector(s);
  const view = $('.gdb-view'), ed = $('.gdb-ed'), status = $('.gdb-status'), issuesEl = $('.gdb-issues');
  const codeEl = $('.gdb-code code'), gate = $('.gdb-gate'), genBtn = $('[data-act="gen"]');
  const S = { key: '', schema: null, sel: 0, issues: [], generated: false, code: '', cols: 0 };
  const stacked = () => matchMedia('(max-width:760px)').matches;
  const behavior = ctx.reduceMotion ? 'auto' : 'smooth';

  const step = (n, on = true) => el.querySelector(`[data-step="${n}"]`).classList.toggle('done', on);
  const fileName = () => `build_${slug(S.key)}.py`;
  const issuesAt = (ci, fi) => S.issues.filter(i => i.ci === ci && (fi === undefined ? true : i.fi === fi));

  function load(key) {
    S.key = key; S.schema = structuredClone(presets[key]); S.sel = 0; S.generated = false; S.code = '';
    $('[data-act="preset"]').value = key;
    $('#gdb-code-h').textContent = fileName();
    step(1); step(2, false); step(3, false);
    buildEditor(); refresh();
    const s = S.schema;
    ctx.announce(status, `${s.label} loaded: ${plural(s.classes.length, 'feature class')}, ${plural(s.domains.length, 'domain')}, ` +
      `${plural(s.relationships.length, 'relationship')}. ${errorCount(S.issues) ? '' : 'No errors.'} Click a card to edit it.`);
  }

  // ---- Graph ---------------------------------------------------------------------------------------
  function drawGraph() {
    const s = S.schema, cols = (S.cols = colsFor()), boxes = layout(s.classes, cols);
    const keys = relationshipKeys(s);
    const W = M * 2 + cols * CW + (cols - 1) * GX + (cols === 1 ? LOOP : 0);
    const H = Math.max(...boxes.map(b => b.y + b.h)) + M;
    const idx = new Map(s.classes.map((c, i) => [c.name.toLowerCase(), i]));
    const rowY = (ci, name) => {
      const fi = s.classes[ci].fields.findIndex(f => f.name.toLowerCase() === String(name).toLowerCase());
      return boxes[ci].y + (fi < 0 ? HEAD / 2 : HEAD + fi * ROW + ROW / 2);
    };
    const edges = s.relationships.map(r => {
      const a = idx.get(String(r.origin).toLowerCase()), b = idx.get(String(r.destination).toLowerCase());
      if (a === undefined || b === undefined) return '';
      const A = boxes[a], B = boxes[b], y1 = rowY(a, r.originKey), y2 = rowY(b, r.foreignKey);
      let d, lx, ly;
      if (A.col === B.col) {
        const x = A.x + CW;
        d = `M${x} ${y1} C${x + LOOP} ${y1} ${x + LOOP} ${y2} ${x} ${y2}`; lx = x + LOOP * 0.75; ly = (y1 + y2) / 2;
      } else {
        const rightward = B.x > A.x, x1 = rightward ? A.x + CW : A.x, x2 = rightward ? B.x : B.x + CW, dx = (x2 - x1) / 2;
        d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`; lx = (x1 + x2) / 2; ly = (y1 + y2) / 2;
      }
      const bad = S.issues.some(i => i.ri === s.relationships.indexOf(r) && i.level === 'error');
      const card = r.cardinality === 'ONE_TO_ONE' ? '1:1' : r.cardinality === 'MANY_TO_MANY' ? 'M:N' : '1:M';
      return `<g class="gdb-rel${bad ? ' bad' : ''}"><title>${esc(r.name)}: ${esc(r.origin)}.${esc(r.originKey)} → ${esc(r.destination)}.${esc(r.foreignKey)}</title>
        <path d="${d}"/><rect x="${lx - 15}" y="${ly - 9}" width="30" height="18" rx="9"/><text x="${lx}" y="${ly + 4}">${card}</text></g>`;
    }).join('');
    const cards = s.classes.map((c, ci) => {
      const b = boxes[ci], nErr = issuesAt(ci).filter(i => i.level === 'error').length, sel = ci === S.sel;
      const rows = c.fields.map((f, fi) => {
        const bad = issuesAt(ci, fi).some(i => i.level === 'error');
        const key = keys.has(`${c.name}.${f.name}`.toLowerCase());
        const t = f.type === 'TEXT' && f.length ? `TEXT(${f.length})` : f.type;
        const y = HEAD + fi * ROW + 13;
        return `<text class="gdb-f${bad ? ' bad' : ''}${key ? ' key' : ''}" x="10" y="${y}">${bad ? '! ' : ''}${esc(clip(f.name || '(blank)', bad ? 15 : 17))}</text>` +
          `<text class="gdb-t" x="${CW - 10}" y="${y}">${esc(t)}${f.domain ? '<tspan class="gdb-d"> ◆</tspan>' : ''}</text>`;
      }).join('');
      const label = `${c.name}, ${c.geometry.toLowerCase()} feature class, ${plural(c.fields.length, 'field')}${nErr ? `, ${plural(nErr, 'error')}` : ''}`;
      return `<g class="gdb-card${sel ? ' sel' : ''}${nErr ? ' bad' : ''}" data-ci="${ci}" transform="translate(${b.x} ${b.y})" tabindex="0" role="button" aria-pressed="${sel}" aria-label="${esc(label)}">
        <rect class="gdb-box" width="${CW}" height="${b.h}" rx="6"/><path class="gdb-head" d="M0 6a6 6 0 0 1 6-6h${CW - 12}a6 6 0 0 1 6 6v${HEAD - 8}h-${CW}z"/>
        <text class="gdb-n" x="10" y="17">${esc(clip(c.name, 18))}</text><text class="gdb-g" x="10" y="29">${c.geometry}</text>
        ${nErr ? `<circle class="gdb-badge" cx="${CW - 14}" cy="16" r="9"/><text class="gdb-badge-t" x="${CW - 14}" y="20">${nErr}</text>` : ''}
        ${rows}</g>`;
    }).join('');
    view.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="max-width:${Math.round(W * 1.15)}px" role="group" aria-label="${esc(s.label)} schema graph">${edges}${cards}</svg>`;
  }

  view.addEventListener('click', e => { const g = e.target.closest('.gdb-card'); if (g) select(+g.dataset.ci, undefined, true); });
  view.addEventListener('keydown', e => {
    const g = e.target.closest('.gdb-card');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(+g.dataset.ci, undefined, true); }
  });

  function select(ci, focusFi, fromCard) {
    S.sel = ci; buildEditor(); drawGraph();
    if (fromCard) view.querySelector(`.gdb-card[data-ci="${ci}"]`)?.focus({ preventScroll: true });
    const c = S.schema.classes[ci];
    status.textContent = `Editing ${c.name} (${c.geometry.toLowerCase()}, ${plural(c.fields.length, 'field')}).`;
    if (focusFi !== undefined) {
      const inp = ed.querySelector(`[data-fi="${focusFi}"] .gdb-name`);
      inp?.scrollIntoView({ block: 'nearest', behavior }); inp?.focus({ preventScroll: true });
    } else if (stacked()) ed.scrollIntoView({ block: 'nearest', behavior });
  }

  // ---- Editor --------------------------------------------------------------------------------------
  function fieldRow(f, fi) {
    const doms = S.schema.domains.map(d => `<option value="${esc(d.name)}"${d.name === f.domain ? ' selected' : ''}>${esc(d.name)} (${d.type} · ${d.kind})</option>`).join('');
    const id = `gdb-e-${fi}`;
    return `<li class="gdb-field" data-fi="${fi}">
      <input type="text" class="gdb-name" value="${esc(f.name)}" aria-label="Field ${fi + 1} name" aria-describedby="${id}" spellcheck="false" autocomplete="off" maxlength="80">
      <select class="gdb-type" aria-label="Field ${fi + 1} type">${FIELD_TYPES.map(t => `<option${t === f.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input type="number" class="gdb-len" value="${f.type === 'TEXT' ? esc(f.length ?? '') : ''}" min="1" step="1" inputmode="numeric" aria-label="Field ${fi + 1} length"${f.type === 'TEXT' ? '' : ' disabled placeholder="–"'}>
      <select class="gdb-dom" aria-label="Field ${fi + 1} domain"><option value="">No domain</option>${doms}</select>
      <label class="demo-chk gdb-null"><input type="checkbox"${f.nullable !== false ? ' checked' : ''}> Nullable</label>
      <button class="gdb-del" type="button" aria-label="Delete field ${esc(f.name || fi + 1)}" title="Delete field">✕</button>
      <p class="gdb-err" id="${id}"></p>
    </li>`;
  }

  function buildEditor() {
    const c = S.schema.classes[S.sel];
    ed.innerHTML = `
      <div class="gdb-ed-head"><h4>${esc(c.name)}</h4><span class="demo-badge demo-badge--info">${c.geometry}</span><span class="gdb-count"></span></div>
      <p class="gdb-hint">Click a card to switch class. Try renaming a field to <code>1st_Name</code> or <code>SHAPE</code>, or giving a number field a text domain.</p>
      <div class="gdb-cls-errs"></div>
      <ol class="gdb-fields">${c.fields.map(fieldRow).join('')}</ol>
      <button class="demo-btn" data-act="add" type="button">+ Field</button>`;
    paintEditorErrors();
  }

  function paintEditorErrors() {
    const ci = S.sel, c = S.schema.classes[ci];
    ed.querySelector('.gdb-count').textContent = plural(c.fields.length, 'field');
    ed.querySelectorAll('.gdb-field').forEach(li => {
      const fi = +li.dataset.fi, msgs = issuesAt(ci, fi).filter(i => i.level === 'error').map(i => i.msg);
      li.classList.toggle('bad', msgs.length > 0);
      li.querySelector('.gdb-name').setAttribute('aria-invalid', String(msgs.length > 0));
      li.querySelector('.gdb-err').textContent = msgs.join(' · ');
    });
    const cls = issuesAt(ci).filter(i => i.fi === undefined && i.level === 'error');
    ed.querySelector('.gdb-cls-errs').innerHTML = cls.map(i => `<p class="demo-callout">${esc(i.msg)}</p>`).join('');
  }

  ed.addEventListener('input', e => {
    const li = e.target.closest('.gdb-field'); if (!li) return;
    const f = S.schema.classes[S.sel].fields[+li.dataset.fi], t = e.target;
    if (t.classList.contains('gdb-name')) f.name = t.value;
    else if (t.classList.contains('gdb-len')) f.length = t.value === '' ? '' : Number(t.value);
    else return;
    edited();
  });
  ed.addEventListener('change', e => {
    const li = e.target.closest('.gdb-field'); if (!li) return;
    const f = S.schema.classes[S.sel].fields[+li.dataset.fi], t = e.target;
    if (t.classList.contains('gdb-type')) {
      f.type = t.value;
      const len = li.querySelector('.gdb-len');
      if (f.type === 'TEXT') { if (!f.length) f.length = 50; len.disabled = false; len.placeholder = ''; len.value = f.length; }
      else { delete f.length; len.disabled = true; len.value = ''; len.placeholder = '–'; }
    } else if (t.closest('.gdb-null')) f.nullable = t.checked;
    else if (t.classList.contains('gdb-dom')) { if (t.value) f.domain = t.value; else delete f.domain; }
    else return;
    edited();
  });
  ed.addEventListener('click', e => {
    const c = S.schema.classes[S.sel];
    if (e.target.closest('[data-act="add"]')) {
      c.fields.push({ name: uniqueFieldName(c), type: 'TEXT', length: 50, nullable: true });
      buildEditor(); edited();
      const inp = ed.querySelector(`[data-fi="${c.fields.length - 1}"] .gdb-name`);
      inp.scrollIntoView({ block: 'nearest', behavior }); inp.focus({ preventScroll: true }); inp.select();
      return;
    }
    const del = e.target.closest('.gdb-del');
    if (del) {
      const fi = +del.closest('.gdb-field').dataset.fi, name = c.fields[fi].name;
      c.fields.splice(fi, 1);
      buildEditor(); edited();
      (ed.querySelector(`[data-fi="${Math.min(fi, c.fields.length - 1)}"] .gdb-name`) ?? ed.querySelector('[data-act="add"]')).focus();
      ctx.announce(status, `Deleted field ${name || '(blank)'} from ${c.name}.`);
    }
  });

  // ---- Validation, code, status --------------------------------------------------------------------
  let statusTimer;
  function edited() {
    step(2);
    refresh();
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      const n = errorCount(S.issues);
      status.className = `demo-status gdb-status ${n ? 'warn' : 'ok'}`;
      status.textContent = n ? `${plural(n, 'error')}. Generate is blocked until they are fixed.` : `Schema valid${S.generated ? ', script updated' : ''}.`;
    }, 450);
  }

  function refresh() {
    S.issues = validate(S.schema);
    drawGraph();
    paintEditorErrors();
    const s = S.schema, errs = errorCount(S.issues);
    const loc = i => i.ci !== undefined ? `${s.classes[i.ci].name}${i.fi !== undefined ? ` · field ${i.fi + 1}` : ''}` : i.di !== undefined ? 'Domains' : 'Relationships';
    issuesEl.innerHTML = (errs ? '' : `<li class="gdb-ok">✓ 0 errors · ${plural(s.classes.length, 'class')}, ${plural(s.classes.reduce((a, c) => a + c.fields.length, 0), 'field')} checked</li>`) +
      S.issues.map((i, n) => {
        const badge = `<span class="demo-badge demo-badge--${i.level === 'error' ? 'high' : 'med'}">${i.level}</span>`;
        const body = `${badge}<span class="gdb-msg">${esc(i.msg)}<small>${esc(loc(i))}</small></span>`;
        return `<li>${i.ci !== undefined ? `<button type="button" class="gdb-issue" data-n="${n}">${body}</button>` : `<div class="gdb-issue">${body}</div>`}</li>`;
      }).join('');
    genBtn.setAttribute('aria-disabled', String(errs > 0));
    genBtn.classList.toggle('gdb-blocked', errs > 0);
    $('[data-act="dlpy"]').disabled = $('[data-act="copy"]').disabled = !S.generated || errs > 0;
    renderCode(errs);
  }

  issuesEl.addEventListener('click', e => {
    const b = e.target.closest('button.gdb-issue'); if (!b) return;
    const i = S.issues[+b.dataset.n];
    select(i.ci, i.fi);
  });

  function renderCode(errs) {
    const wrap = $('.gdb-code');
    if (errs) {
      gate.innerHTML = `<p class="demo-callout" role="note"><b>Generate is blocked:</b> ${plural(errs, 'error')} in the schema. Fix the items marked in red, then the script rebuilds.</p>`;
      wrap.classList.add('stale');
      if (!S.generated) codeEl.textContent = '# The ArcPy build script appears here once the schema is valid.';
      return;
    }
    gate.innerHTML = '';
    wrap.classList.remove('stale');
    if (!S.generated) { codeEl.textContent = '# Click "Generate ArcPy" to build the script for this schema.'; return; }
    S.code = generate(S.schema);
    codeEl.innerHTML = highlight(S.code, 'python');
  }

  // ---- Controls ------------------------------------------------------------------------------------
  el.querySelector('.demo-ctl').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset') load(S.key);
    if (act !== 'gen') return;
    clearTimeout(statusTimer);
    const n = errorCount(S.issues);
    if (n) {
      renderCode(n);
      status.className = 'demo-status gdb-status warn';
      ctx.announce(status, `Generate is blocked: ${plural(n, 'error')}. Fix them first.`);
      issuesEl.querySelector('button.gdb-issue')?.focus({ preventScroll: true });
      $('.gdb-bottom').scrollIntoView({ block: 'nearest', behavior });
      return;
    }
    S.generated = true; step(3); refresh();
    const lines = S.code.split('\n').length - 1;
    status.className = 'demo-status gdb-status ok';
    ctx.announce(status, `✓ Generated ${fileName()}: ${lines} lines of ArcPy. Copy it or download it below.`);
    $('.gdb-codebox').scrollIntoView({ block: 'nearest', behavior });
  });
  $('[data-act="preset"]').addEventListener('change', e => load(e.target.value));

  $('.gdb-codehead').addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'dljson') ctx.saveText('schema.json', toSchemaJSON(S.schema), 'application/json');
    if (!S.code || errorCount(S.issues)) return;
    if (act === 'dlpy') ctx.saveText(fileName(), S.code, 'text/x-python');
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(S.code); ctx.toast(`Copied ${S.code.split('\n').length - 1} lines of ArcPy`); }
      catch { getSelection().selectAllChildren(codeEl); ctx.toast('Selected the script. Press Ctrl+C to copy.'); }
    }
  });

  // Responsive graph: 3 columns on wide panes, 2 on medium, 1 on phones.
  function colsFor() { const w = view.clientWidth || 700; return w >= 620 ? 3 : w >= 420 ? 2 : 1; }
  const ro = new ResizeObserver(() => { if (S.schema && colsFor() !== S.cols) drawGraph(); });
  ro.observe(view);

  load(Object.keys(presets)[0]);
  if (!ctx.reduceMotion) genBtn.classList.add('demo-pulse');
  return () => { ro.disconnect(); clearTimeout(statusTimer); };
}
