// ArcPy Reporting & QA Suite: live demo view. Logic lives in engine.js; this file only builds DOM.
import { highlight } from '../lib/highlight.js';
import { CHECKS, LABELS, parseYAML, setEnabled, runSuite, layoutSVG, reportHTML, csvRows, CSV_COLUMNS, esc } from './engine.js';

const PROFILES = ['county_permits.yaml', 'osp_monthly.yaml'];
const SHORT = { null_fields: 'Null field', duplicate_ids: 'Duplicate ID', length_mismatch: 'Length', orphans: 'Orphan', domain: 'Domain' };
const SEV_LABEL = { high: 'High', med: 'Med', low: 'Low' };

export async function mount(el, ctx) {
  const [data, ...texts] = await Promise.all([ctx.json('data.json'), ...PROFILES.map(p => fetch(ctx.asset(p)).then(r => r.text()))]);
  const original = Object.fromEntries(PROFILES.map((p, i) => [p, texts[i]]));
  const edited = { ...original };
  let file = PROFILES[0], timers = [], result = null, svg = '', runDate = '', parseTimer = 0, ran = { src: '', file: '' };

  el.innerHTML = `
  <div class="demo-ctl">
    <ol class="demo-steps"><li>Pick a profile</li><li>Run suite</li><li>Download the report</li></ol>
    <span class="demo-spacer"></span>
    <label class="qa-pick">Profile <select aria-label="Config profile">${PROFILES.map(p => `<option>${p}</option>`).join('')}</select></label>
    <button type="button" class="demo-btn demo-btn--primary qa-run">▶ Run suite</button>
  </div>
  <div class="qa-top">
    <section class="qa-cfg" aria-label="Configuration">
      <div class="qa-head"><span>config/<b class="qa-file"></b></span><button type="button" class="qa-link qa-reset">Reset edits</button></div>
      <div class="qa-ed"><pre aria-hidden="true"><code></code></pre><textarea spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="Profile YAML, editable"></textarea></div>
      <p class="qa-parse"></p>
      <fieldset class="qa-checks"><legend>Checks</legend>${CHECKS.map(k => `<label class="demo-chk"><input type="checkbox" value="${k}"> ${LABELS[k]}</label>`).join('')}</fieldset>
    </section>
    <section class="qa-term" aria-label="Run log">
      <div class="qa-head"><span><i></i><i></i><i></i> run_suite.py</span><span class="qa-clock"></span></div>
      <pre class="qa-log" aria-live="off" tabindex="0"></pre>
    </section>
  </div>
  <div class="demo-split qa-res">
    <div class="demo-view qa-map"><p class="qa-empty">The map export layout is generated here after a run.</p></div>
    <div class="demo-out">
      <p class="demo-status" aria-live="polite">Pick a profile, adjust the YAML or the check toggles, then run the suite.</p>
      <div class="demo-stats" hidden></div>
      <div class="qa-tbl" hidden><table class="demo-table"><thead><tr><th>Rule</th><th>Feature</th><th>Field</th><th>Message</th><th>Sev</th></tr></thead><tbody></tbody></table></div>
      <div class="demo-dl"><button type="button" class="demo-btn qa-csv" disabled>⤓ qa-report.csv</button><button type="button" class="demo-btn qa-html" disabled>⤓ qa-report.html</button></div>
    </div>
  </div>
  <p class="demo-foot">Same rules as the production tool. Synthetic data, no client information. ArcPy calls are simulated; the QA checks run for real in your browser.</p>`;

  const $ = s => el.querySelector(s);
  const sel = $('select'), ta = $('textarea'), code = $('.qa-ed code'), pre = $('.qa-ed pre'), parseEl = $('.qa-parse');
  const runBtn = $('.qa-run'), log = $('.qa-log'), status = $('.demo-status'), stats = $('.demo-stats');
  const tblWrap = $('.qa-tbl'), tbody = $('tbody'), map = $('.qa-map'), csvBtn = $('.qa-csv'), htmlBtn = $('.qa-html');
  const steps = [...el.querySelectorAll('.demo-steps li')];
  const boxes = [...el.querySelectorAll('.qa-checks input')];
  const done = n => steps[n].classList.add('done');
  if (!ctx.reduceMotion) runBtn.classList.add('demo-pulse');

  const paint = () => { code.innerHTML = highlight(ta.value, 'yaml') + '\n'; pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  function syncChecks() {
    try {
      const doc = parseYAML(ta.value);
      const c = doc.checks && typeof doc.checks === 'object' ? doc.checks : {};
      const on = CHECKS.filter(k => c[k] != null && c[k].enabled !== false);
      boxes.forEach(b => (b.checked = on.includes(b.value)));
      parseEl.className = 'qa-parse ok';
      parseEl.textContent = `✓ valid YAML · ${on.length} of ${CHECKS.length} checks enabled`;
    } catch (e) {
      parseEl.className = 'qa-parse err';
      parseEl.textContent = `✗ ${e.message}`;
    }
  }
  function load(name) {
    file = name;
    $('.qa-file').textContent = name;
    ta.value = edited[name];
    ta.scrollTop = 0;
    paint(); syncChecks();
  }
  function stale(msg) {
    if (!result) return;
    status.className = 'demo-status warn';
    status.textContent = msg;
  }

  sel.addEventListener('change', () => { load(sel.value); done(0); stale('Profile changed. Run the suite again to refresh the results.'); });
  ta.addEventListener('input', () => {
    edited[file] = ta.value; paint(); done(0);
    clearTimeout(parseTimer); parseTimer = setTimeout(syncChecks, 200);
    stale('Config edited. Run the suite again to apply it.');
  });
  ta.addEventListener('scroll', () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  });
  boxes.forEach(b => b.addEventListener('change', () => {
    const top = ta.scrollTop;
    ta.value = edited[file] = setEnabled(ta.value, b.value, b.checked);
    ta.scrollTop = top; paint(); syncChecks(); done(0);
    stale(`${LABELS[b.value]} ${b.checked ? 'enabled' : 'disabled'}. Run the suite again to apply it.`);
  }));
  $('.qa-reset').addEventListener('click', () => { edited[file] = original[file]; load(file); ctx.announce(parseEl, `${file} restored`); });

  const two = n => String(n).padStart(2, '0');
  const clock = d => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  function line(step, t0) {
    const div = document.createElement('div');
    div.className = `ln ln-${step.level}`;
    div.innerHTML = step.level === 'cmd'
      ? `<span class="ts">${step.tag}</span> ${esc(step.text)}`
      : `<span class="ts">[${clock(new Date(t0 + step.at))}]</span> <span class="tg">${esc(step.tag.padEnd(20))}</span>${esc(step.text)}`;
    log.append(div);
    log.scrollTop = log.scrollHeight;
  }

  function run() {
    timers.forEach(clearTimeout); timers = [];
    runBtn.classList.remove('demo-pulse');
    syncChecks(); done(0);
    ran = { src: ta.value, file };
    const res = runSuite(ran.src, data, { file });
    const t0 = Date.now();
    log.textContent = '';
    runBtn.disabled = true; sel.disabled = true;
    status.className = 'demo-status';
    ctx.announce(status, `Running ${file}…`);
    const finish = () => { runBtn.disabled = false; sel.disabled = false; show(res, t0); };
    if (ctx.reduceMotion) { res.steps.forEach(s => line(s, t0)); finish(); return; }
    res.steps.forEach(s => timers.push(setTimeout(() => line(s, t0), s.at)));
    timers.push(setTimeout(finish, res.steps.at(-1).at + 120));
  }
  runBtn.addEventListener('click', run);

  function show(res, t0) {
    result = res.ok ? res : null;
    $('.qa-clock').textContent = clock(new Date(t0));
    csvBtn.disabled = htmlBtn.disabled = !res.ok;
    if (!res.ok) {
      stats.hidden = tblWrap.hidden = true;
      status.className = 'demo-status warn';
      ctx.announce(status, `Run aborted: ${res.error}. Fix the YAML and run again.`);
      return;
    }
    done(1);
    const s = res.stats;
    runDate = new Date(t0).toISOString().slice(0, 10);
    stats.hidden = false;
    stats.innerHTML = [['Features', s.rows], ['Checks', s.checksRun], ['Findings', s.findings], ['High', s.bySev.high], ['Med', s.bySev.med], ['Low', s.bySev.low], ['Clean', `${s.cleanPct}%`], ['Elapsed', `${(s.elapsedMs / 1000).toFixed(1)} s`]]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    svg = layoutSVG(res, data, { date: runDate });
    map.innerHTML = `<figure class="qa-page">${svg}<figcaption>Layout thumbnail · qa_map_${esc(res.cfg.profile)}.pdf</figcaption></figure>`;
    map.querySelectorAll('path.f').forEach(p => p.addEventListener('click', () => {
      const row = tbody.querySelector(`tr[data-i="${p.dataset.i}"]`);
      if (row) { select(row); row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true }); }
    }));
    tblWrap.hidden = false;
    tbody.innerHTML = res.findings.length
      ? res.findings.map(f => `<tr tabindex="0" data-i="${f.i}" title="OID ${f.i + 1}"><td>${SHORT[f.rule]}</td><td>${esc(f.id)}</td><td>${esc(f.field)}</td><td>${esc(f.message)}</td><td><span class="demo-badge demo-badge--${f.severity}">${SEV_LABEL[f.severity]}</span></td></tr>`).join('')
      : '<tr><td colspan="5">No findings. Every enabled check passed.</td></tr>';
    status.className = `demo-status ${res.verdict === 'PASS' ? 'ok' : 'warn'}`;
    ctx.announce(status, `${res.verdict}: ${s.findings} findings across ${s.flagged} of ${s.rows} features (${s.bySev.high} high). Click a row to find it on the map.`);
  }

  function select(row) {
    tbody.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel'));
    row.classList.add('sel');
    const svgEl = map.querySelector('svg');
    svgEl.classList.add('has-sel');
    svgEl.querySelectorAll('path.sel').forEach(p => p.classList.remove('sel'));
    const p = svgEl.querySelector(`path[data-i="${row.dataset.i}"]`);
    if (p) { p.classList.add('sel'); p.parentNode.append(p); }
  }
  tbody.addEventListener('click', e => { const r = e.target.closest('tr[data-i]'); if (r) select(r); });
  tbody.addEventListener('keydown', e => {
    const r = e.target.closest('tr[data-i]');
    if (!r) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling;
      if (n) { n.focus(); select(n); }
    }
  });

  csvBtn.addEventListener('click', () => {
    if (!result) return;
    ctx.saveText('qa-report.csv', ctx.toCSV(csvRows(result), CSV_COLUMNS), 'text/csv');
    done(2); ctx.toast(`qa-report.csv saved · ${result.findings.length} rows`);
  });
  htmlBtn.addEventListener('click', () => {
    if (!result) return;
    ctx.saveText('qa-report.html', reportHTML(result, svg, ran.src, { date: runDate, file: ran.file }), 'text/html');
    done(2); ctx.toast('qa-report.html saved · open it in any browser');
  });

  load(file);
  return () => timers.forEach(clearTimeout);
}
