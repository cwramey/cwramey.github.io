// Canvas demo UI: SVG job map, splice tray, trace, BOM, QC gate. Logic lives in engine.js.
import * as E from './engine.js';
import { toPath } from '../lib/geom.js';

const NS = 'http://www.w3.org/2000/svg';
const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = n => n.toLocaleString('en-US');

export async function mount(el, ctx) {
  const data = await ctx.json('data.json');
  let hlId, job, qcRun, findings, submitted, sel, trayN, lastTrace, wasBlocked, outTab;

  el.innerHTML = `
  <div class="demo-ctl">
    <ol class="demo-steps"><li data-s="1">Splice fibers</li><li data-s="2">Trace a drop</li><li data-s="3">Run QC &amp; submit</li></ol>
    <span class="demo-spacer"></span>
    <button class="demo-btn" data-act="bom">Generate BOM</button>
    <button class="demo-btn demo-btn--primary" data-act="qc">Run QC</button>
    <button class="demo-btn" data-act="reset" title="Back to the seeded job">Reset</button>
  </div>
  <div class="demo-split">
    <div class="demo-view cv-left">
      <svg class="cv-map" viewBox="0 0 640 360" role="group" aria-label="Job map: CO cabinet, feeder, splice closure SC-01, two distribution cables and four drops"></svg>
      <div class="cv-drops" role="group" aria-label="Trace a drop"><span>Trace:</span></div>
      <section class="cv-tray" aria-label="Splice tray">
        <div class="cv-tray-head">
          <b>SC-01</b>
          <div class="cv-seg" role="group" aria-label="Tray"></div>
          <span class="demo-spacer"></span>
          <button class="demo-btn" data-act="auto">Auto-splice 1:1</button>
          <button class="demo-btn" data-act="unsplice" disabled>Unsplice</button>
        </div>
        <p class="cv-hint">Click a feeder fiber, then a distribution fiber to splice. <kbd>Esc</kbd> clears the selection.</p>
        <div class="cv-grid">
          <div class="cv-col" data-side="in"></div>
          <svg class="cv-links" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div class="cv-col" data-side="out"></div>
        </div>
      </section>
    </div>
    <div class="demo-out">
      <p class="demo-status" role="status" aria-live="polite"></p>
      <div class="cv-gate"></div>
      <div class="cv-seg cv-tabs" role="group" aria-label="Output">
        <button data-tab="splices">Splices</button><button data-tab="trace">Trace</button><button data-tab="bom">BOM</button><button data-tab="qc">QC</button>
      </div>
      <div class="cv-panel"></div>
      <div class="demo-dl">
        <button class="demo-btn" data-act="dl-splice">⤓ splice-report.csv</button>
        <button class="demo-btn" data-act="dl-bom">⤓ bom.csv</button>
      </div>
    </div>
  </div>
  <p class="demo-foot">Same rules as the production tool. Synthetic data, no client information.</p>`;

  const $ = s => el.querySelector(s);
  const map = $('.cv-map'), status = $('.demo-status'), panel = $('.cv-panel'), gate = $('.cv-gate');
  const colIn = $('[data-side="in"]'), colOut = $('[data-side="out"]'), links = $('.cv-links');
  const say = (msg, tone = '') => { status.className = 'demo-status ' + tone; ctx.announce(status, msg); };
  const step = (n, on = true) => el.querySelector(`[data-s="${n}"]`).classList.toggle('done', on);

  // ---- map -------------------------------------------------------------------
  const svg = (tag, attrs, parent = map) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.append(n); return n;
  };
  const text = (x, y, s, cls = 'lbl', anchor = 'middle') => (svg('text', { x, y, class: cls, 'text-anchor': anchor }).textContent = s);

  function drawMap() {
    map.innerHTML = '';
    for (const r of [[[0, 196], [640, 196]], [[300, 0], [370, 360]], [[380, 70], [640, 58]], [[380, 300], [640, 300]]]) svg('path', { d: toPath(r), class: 'road' });
    for (const c of job.cables) {
      svg('path', { d: toPath(c.coords), class: `cab cab--${c.kind}`, 'data-fid': c.id });
      const i = c.kind === 'feeder' ? 0 : 1, m = [(c.coords[i][0] + c.coords[i + 1][0]) / 2, (c.coords[i][1] + c.coords[i + 1][1]) / 2];
      text(m[0], m[1] + (c.id === 'DIST-A' ? -9 : 18), `${c.id} · ${c.fiberCount}-ct`, 'lbl lbl--cab');
    }
    for (const d of job.drops) {
      const lit = E.splicesAt(job, d.cable, d.fiber).length > 0, h = d.coords[1];
      const g = svg('g', { class: `drop ${lit ? 'lit' : 'dark'}`, 'data-fid': d.id, tabindex: 0, role: 'button', 'aria-label': `Trace ${d.label}, ${d.address}${lit ? '' : ' (dark)'}` });
      svg('path', { d: toPath(d.coords), class: 'dropline' }, g);
      svg('rect', { x: h[0] - 9, y: h[1] - 8, width: 18, height: 14, rx: 2, class: 'house' }, g);
      svg('path', { d: `M${h[0] - 11} ${h[1] - 7}L${h[0]} ${h[1] - 16}L${h[0] + 11} ${h[1] - 7}`, class: 'roof' }, g);
      const r = h[0] < 590;
      text(h[0] + (r ? 14 : -14), h[1] + 4, d.label, 'lbl', r ? 'start' : 'end');
    }
    for (const p of job.poles) {
      svg('circle', { cx: p.xy[0], cy: p.xy[1], r: 4.5, class: 'pole', 'data-fid': p.id });
      if (!/00/.test(p.id)) text(p.xy[0], p.xy[1] + (p.xy[1] > 200 ? 18 : -10), p.id, 'lbl lbl--pole');
    }
    const [cx, cy] = job.co.xy;
    svg('rect', { x: cx - 16, y: cy - 16, width: 32, height: 32, rx: 3, class: 'co', 'data-fid': job.co.id });
    text(cx, cy + 4, 'CO', 'lbl lbl--in'); text(cx, cy + 32, job.co.id);
    const [sx, sy] = job.closure.xy;
    svg('path', { d: `M${sx} ${sy - 13}L${sx + 13} ${sy}L${sx} ${sy + 13}L${sx - 13} ${sy}Z`, class: 'sc', 'data-fid': job.closure.id });
    text(sx - 18, sy - 14, 'SC-01', 'lbl lbl--sc', 'end');
    svg('path', { class: 'trace', d: 'M0 0' });
    svg('g', { class: 'stop' });
    if (hlId) highlight(hlId);
  }

  function highlight(fid) {
    hlId = fid;
    map.querySelectorAll('.hl').forEach(n => n.classList.remove('hl'));
    map.querySelectorAll(`[data-fid="${fid}"]`).forEach(n => n.classList.add('hl'));
  }

  // ---- splice tray -------------------------------------------------------------
  function fiberBtn(side, cableId, n, label, extra) {
    const c = E.fiberColor(n), sp = E.splicesAt(job, cableId, n)[0];
    const pressed = sel && sel.side === side && sel.n === n;
    return `<button class="cv-fiber${sp ? ' on' : ''}" data-side="${side}" data-n="${n}" aria-pressed="${pressed}"
      aria-label="${cableId} fiber ${n}, ${c.color.name}${sp ? ', spliced' : ', free'}${extra ? ', feeds ' + extra : ''}">
      <i style="background:${c.color.hex}"></i><span>${label}</span>${extra ? `<em>${extra}</em>` : ''}</button>`;
  }

  function drawTray() {
    const { tray: t, input, output } = E.trayFibers(job, trayN);
    $('.cv-tray .cv-seg').innerHTML = job.closure.trays.map(x =>
      `<button data-tray="${x.n}" aria-pressed="${x.n === trayN}">Tray ${x.n} · ${x.out}</button>`).join('');
    colIn.innerHTML = `<h4>${t.in} · T${E.fiberColor(t.inFrom).tube} ${E.fiberColor(t.inFrom).tubeColor.name}</h4>` +
      input.map(n => fiberBtn('in', t.in, n, `F${n} ${E.fiberColor(n).color.name}`)).join('');
    colOut.innerHTML = `<h4>${t.out}</h4>` + output.map(n => {
      const d = job.drops.find(x => x.cable === t.out && x.fiber === n);
      return fiberBtn('out', t.out, n, `F${n} ${E.fiberColor(n).color.name}`, d && d.label);
    }).join('');
    // connector lines between spliced pairs
    const H = 12 * 34;
    links.setAttribute('viewBox', `0 0 100 ${H}`);
    links.innerHTML = job.splices.filter(s => s.tray === trayN).map(s => {
      const y1 = (s.a[1] - t.inFrom) * 34 + 15, y2 = (s.b[1] - 1) * 34 + 15;
      return `<path d="M0 ${y1}C50 ${y1} 50 ${y2} 100 ${y2}" stroke="${E.fiberColor(s.a[1]).color.hex}" vector-effect="non-scaling-stroke"/>`;
    }).join('');
    $('[data-act="unsplice"]').disabled = !(sel && E.splicesAt(job, sel.side === 'in' ? t.in : t.out, sel.n).length);
  }

  function clickFiber(side, n, focus = true) {
    const t = E.tray(job, trayN), cab = side === 'in' ? t.in : t.out;
    const sp = E.splicesAt(job, cab, n)[0];
    if (sp) {
      sel = { side, n };
      say(`${E.fiberName(cab, n)} is spliced to ${side === 'in' ? E.fiberName(...sp.b) : E.fiberName(...sp.a)} (${sp.id}). Press Unsplice to break it.`);
    } else if (sel && sel.side !== side && !E.splicesAt(job, sel.side === 'in' ? t.in : t.out, sel.n).length) {
      const [a, b] = side === 'out' ? [sel.n, n] : [n, sel.n];
      const r = E.addSplice(job, trayN, a, b);
      sel = null;
      if (r.ok) { step(1); changed(`Spliced ${E.fiberName(t.in, a)} → ${E.fiberName(t.out, b)} on tray ${trayN}.`, 'ok'); }
      else say(r.error, 'warn');
    } else {
      sel = { side, n };
      say(`Selected ${E.fiberName(cab, n)}. Now pick a free fiber on ${side === 'in' ? t.out : t.in}.`);
    }
    drawTray();
    if (focus) el.querySelector(`.cv-fiber[data-side="${side}"][data-n="${n}"]`)?.focus();
  }

  // ---- outputs -----------------------------------------------------------------
  function showTab(name) {
    outTab = name;
    el.querySelectorAll('.cv-tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === name));
    panel.innerHTML = ({ splices: splicePanel, trace: tracePanel, bom: bomPanel, qc: qcPanel })[name]();
  }

  function splicePanel() {
    const rows = E.spliceReport(job);
    return `<table class="demo-table"><thead><tr><th>Tray</th><th>In</th><th>Out</th><th>Serves</th><th></th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${r.tray}</td><td><i class="sw" style="background:${E.fiberColor(r.in_fiber).color.hex}"></i>${r.in_cable} F${r.in_fiber}</td>
      <td><i class="sw" style="background:${E.fiberColor(r.out_fiber).color.hex}"></i>${r.out_cable} F${r.out_fiber}</td><td>${r.serves}</td>
      <td><button class="cv-x" data-unsplice="${r.out_cable}:${r.out_fiber}" aria-label="Unsplice ${r.splice_id}">✕</button></td></tr>`).join('')}</tbody></table>
      <p class="cv-sub">${rows.length} splices at SC-01 · drops dark: ${job.drops.filter(d => !E.splicesAt(job, d.cable, d.fiber).length).map(d => d.label).join(', ') || 'none'}</p>`;
  }

  function tracePanel() {
    if (!lastTrace) return `<p class="cv-sub">Click a drop on the map (or a Trace button) to walk its fiber back to the CO.</p>`;
    const t = lastTrace;
    return `<div class="demo-callout${t.complete ? ' demo-callout--ok' : ''}">${t.message}</div>
      <ol class="cv-hops">${t.hops.map(h => `<li class="${h.stop ? 'stop' : ''}" data-fid="${h.featureId}">${h.label}</li>`).join('')}</ol>`;
  }

  function bomPanel() {
    const b = E.bom(job);
    return `<div class="demo-stats"><div><span>Footage</span><b>${num(b.footage)} ft</b></div><div><span>Splices</span><b>${job.splices.length}</b></div><div><span>Total</span><b>${money(b.total)}</b></div></div>
      <table class="demo-table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Cost</th></tr></thead><tbody>${b.rows.map(r =>
      `<tr><td>${r.item}</td><td class="num">${num(r.qty)} ${r.unit}</td><td class="num">${money(r.rate)}</td><td class="num">${money(r.cost)}</td></tr>`).join('')}
      <tr class="cv-total"><td colspan="3">Total</td><td class="num">${money(b.total)}</td></tr></tbody></table>
      <p class="cv-sub">Built from drawn geometry × cost rates in data.json. Re-run after splicing to see the splice line change.</p>`;
  }

  function qcPanel() {
    if (!qcRun) return `<p class="cv-sub">Run QC to check the job against 5 rules: unspliced fiber, drop length, missing attributes, double splices and fiber counts.</p>`;
    if (!findings.length) return `<div class="demo-callout demo-callout--ok">No findings. Clean job.</div>`;
    return `<table class="demo-table cv-qc"><thead><tr><th>Severity</th><th>Finding</th></tr></thead><tbody>${findings.map((f, i) =>
      `<tr tabindex="0" data-f="${i}" aria-label="${f.severity}: ${f.message}"><td><span class="demo-badge demo-badge--${f.severity.toLowerCase()}">${f.severity}</span></td>
      <td><b>${f.featureId}</b> ${f.message}<br><span class="cv-fix">Fix: ${f.suggestedFix}</span></td></tr>`).join('')}</tbody></table>
      <p class="cv-sub">Click a finding to highlight it on the map. Blockers jump to the fiber in the tray.</p>`;
  }

  function drawGate(justCleared) {
    const blockers = qcRun ? findings.filter(f => f.severity === 'Blocker').length : 0;
    const ready = qcRun && !blockers;
    const msg = submitted ? `✓ ${job.job.id} submitted for review.`
      : !qcRun ? 'Submit unlocks after QC runs with no open Blocker.'
      : blockers ? `Submit disabled: ${blockers} open Blocker${blockers > 1 ? 's' : ''}.`
      : `${justCleared ? 'Blocker cleared. ' : ''}No open Blockers. Submit is enabled.`;
    gate.className = `cv-gate ${submitted || ready ? 'ok' : blockers ? 'bad' : ''}`;
    gate.innerHTML = `<span class="cv-light" aria-hidden="true"></span><span>${msg}</span>
      <button class="demo-btn demo-btn--primary${justCleared && !ctx.reduceMotion ? ' demo-pulse' : ''}" data-act="submit" ${ready && !submitted ? '' : 'disabled'}>Submit job</button>`;
  }

  // Called after any edit to the job.
  function changed(msg, tone) {
    submitted = false; step(3, false);
    drawMap();
    if (lastTrace) { const id = lastTrace.dropId; lastTrace = E.trace(job, id); lastTrace.dropId = id; drawTrace(false); }
    let cleared = false;
    if (qcRun) {
      findings = E.runQC(job);
      const blocked = !E.canSubmit(findings);
      cleared = wasBlocked && !blocked; wasBlocked = blocked;
      if (cleared) msg += ' QC re-ran: Blocker cleared, Submit is enabled.';
      else if (blocked) msg += ` QC re-ran: ${findings.filter(f => f.severity === 'Blocker').length} Blocker open.`;
    }
    drawGate(cleared);
    showTab(outTab);
    say(msg, tone);
  }

  function drawTrace(animate = true) {
    const t = lastTrace, line = map.querySelector('.trace'), stop = map.querySelector('.stop');
    const pts = t.complete ? t.path : [...t.path].reverse().concat([job.closure.xy]);
    line.setAttribute('d', toPath(pts));
    line.setAttribute('class', 'trace ' + (t.complete ? 'ok' : 'bad'));
    stop.innerHTML = '';
    const len = line.getTotalLength();
    line.style.transition = 'none';
    line.style.strokeDasharray = len; line.style.strokeDashoffset = animate && !ctx.reduceMotion ? len : 0;
    if (animate && !ctx.reduceMotion) { line.getBoundingClientRect(); line.style.transition = 'stroke-dashoffset 1.3s ease-in-out'; line.style.strokeDashoffset = 0; }
    if (!t.complete) {
      const [x, y] = job.closure.xy;
      svg('circle', { cx: x, cy: y, r: 17, class: 'stop-ring' }, stop);
      svg('path', { d: `M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}`, class: 'stop-x' }, stop);
    }
  }

  function doTrace(id) {
    lastTrace = E.trace(job, id); lastTrace.dropId = id;
    drawTrace(true); highlight(id); step(2);
    showTab('trace');
    say(lastTrace.message, lastTrace.complete ? 'ok' : 'warn');
  }

  function runQC() {
    qcRun = true; findings = E.runQC(job);
    wasBlocked = !E.canSubmit(findings);
    drawGate(false); showTab('qc');
    const n = s => findings.filter(f => f.severity === s).length;
    say(`QC: ${n('Blocker')} Blocker, ${n('Major')} Major, ${n('Minor')} Minor.${wasBlocked ? ' Submit stays disabled until the Blocker is fixed.' : ' Submit is enabled.'}`, wasBlocked ? 'warn' : 'ok');
  }

  function pickFinding(i) {
    const f = findings[i];
    highlight(f.featureId);
    el.querySelectorAll('.cv-qc tr.sel').forEach(r => r.classList.remove('sel'));
    el.querySelector(`.cv-qc tr[data-f="${i}"]`)?.classList.add('sel');
    const d = job.drops.find(x => x.id === f.featureId);
    if (f.rule === 'unsplicedFiber' && d) {
      trayN = job.closure.trays.find(t => t.out === d.cable).n;
      sel = { side: 'out', n: d.fiber }; drawTray();
      say(`${f.message} Selected ${d.cable} F${d.fiber} in tray ${trayN}: now click a free feeder fiber, or press Auto-splice 1:1.`, 'warn');
      el.querySelector(`.cv-fiber[data-side="out"][data-n="${d.fiber}"]`)?.scrollIntoView({ block: 'nearest', behavior: ctx.reduceMotion ? 'auto' : 'smooth' });
    } else say(`${f.featureId}: ${f.suggestedFix}`);
  }

  function reset() {
    job = E.createJob(data); qcRun = false; findings = []; submitted = false; sel = null; trayN = 2;
    lastTrace = null; wasBlocked = false; hlId = null;
    [1, 2, 3].forEach(n => step(n, false));
    drawMap(); drawTray(); drawGate(false); showTab('splices');
    say(`${job.job.id} · ${job.job.name}. Tray 2 is half done and Drop 4 is dark. Splice a fiber, trace a drop, then run QC.`);
  }

  // ---- events --------------------------------------------------------------------
  $('.cv-drops').insertAdjacentHTML('beforeend', data.drops.map(d => `<button class="demo-btn" data-trace="${d.id}">${d.label}</button>`).join(''));

  el.addEventListener('click', e => {
    const b = e.target.closest('button, .drop, .cv-qc tr, .cv-hops li');
    if (!b) return;
    const a = b.dataset;
    if (b.classList.contains('cv-fiber')) return clickFiber(a.side, +a.n);
    if (b.classList.contains('drop')) return doTrace(a.fid);
    if (a.f) return pickFinding(+a.f);
    if (a.fid) return highlight(a.fid);
    if (a.trace) return doTrace(a.trace);
    if (a.tray) { trayN = +a.tray; sel = null; drawTray(); return say(`Tray ${trayN}: ${E.tray(job, trayN).in} → ${E.tray(job, trayN).out}.`); }
    if (a.tab) return showTab(a.tab);
    if (a.unsplice) { const [c, n] = a.unsplice.split(':'); E.removeSplice(job, c, +n); drawTray(); return changed(`Removed the splice on ${c} F${n}.`, 'warn'); }
    switch (a.act) {
      case 'auto': { const n = E.autoSplice(job, trayN); sel = null; drawTray(); if (n) step(1); return changed(n ? `Auto-splice added ${n} splices on tray ${trayN}.` : `Tray ${trayN} has no free pairs left.`, n ? 'ok' : ''); }
      case 'unsplice': { const t = E.tray(job, trayN); E.removeSplice(job, sel.side === 'in' ? t.in : t.out, sel.n); sel = null; drawTray(); return changed('Splice removed.', 'warn'); }
      case 'bom': showTab('bom'); return say(`BOM generated: ${money(E.bom(job).total)} across ${E.bom(job).rows.length} line items.`, 'ok');
      case 'qc': return runQC();
      case 'submit': submitted = true; step(3); drawGate(false); ctx.toast(`${job.job.id} submitted for review (simulated: nothing leaves your browser).`); return say(`${job.job.id} submitted.`, 'ok');
      case 'reset': return reset();
      case 'dl-splice': return ctx.saveText('splice-report.csv', ctx.toCSV(E.spliceReport(job)), 'text/csv');
      case 'dl-bom': { const b = E.bom(job); return ctx.saveText('bom.csv', ctx.toCSV([...b.rows, { item: 'TOTAL', cost: b.total }], ['item', 'qty', 'unit', 'rate', 'cost']), 'text/csv'); }
    }
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sel) { sel = null; drawTray(); say('Selection cleared.'); }
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && (t.classList.contains('drop') || t.matches('.cv-qc tr'))) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  reset();
  $('[data-act="qc"]').classList.toggle('demo-pulse', !ctx.reduceMotion);
}
