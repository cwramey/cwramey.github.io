// Node: simulated dispatch day. Renders the engine's state on an SVG map in local feet.
import {
  buildDay, statusFor, visible, position, filterCrews, contractorStats, statusCounts, hourHistogram,
  lateSyncs, exportRows, CSV_COLUMNS, STATUS, STATUS_ORDER, LATE_SYNC, fmt, tick,
} from './engine.js';

const NS = 'http://www.w3.org/2000/svg';
const SPEEDS = [120, 480, 1800];
const TYPE_LABEL = { install: 'Install', repair: 'Repair', inspection: 'Inspection' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = m => (m < 1 ? 'just now' : m < 60 ? `${Math.floor(m)} min ago` : `${Math.floor(m / 60)} h ${Math.floor(m % 60)} min ago`);
const num = n => n.toLocaleString('en-US');
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

export async function mount(el, ctx) {
  const data = await ctx.json('data.json');
  const day = buildDay(data);
  const [D0, D1] = day.day;
  const { w: W, h: H, grid } = data.map;

  el.innerHTML = `
  <div class="demo-ctl"><ol class="demo-steps"><li>Press Play</li><li>Open a crew</li><li>Message or export</li></ol></div>
  <div class="demo-ctl nd-ctl">
    <button class="demo-btn demo-btn--primary demo-pulse" data-a="play" aria-pressed="false">▶ Play</button>
    <span class="nd-clock" aria-hidden="true">06:00</span>
    <input class="nd-scrub" type="range" min="${D0}" max="${D1}" step="0.5" value="${D0}" aria-label="Simulated time of day">
    <button class="demo-btn" data-a="speed" aria-label="Playback speed">${SPEEDS[0]}×</button>
    <label class="nd-reg">Region <select data-a="region"><option value="all">All regions</option>${day.regions.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select></label>
    <span class="demo-spacer"></span>
    <button class="demo-btn" data-a="export">⬇ Export today</button>
  </div>
  <div class="demo-split">
    <div class="demo-view nd-left">
      <div class="nd-map"></div>
      <div class="nd-hist"><p class="nd-h">Reports by hour recorded</p></div>
    </div>
    <div class="demo-out">
      <p class="demo-status" aria-live="polite">Press Play to run a sample dispatch day, 06:00–19:00.</p>
      <div class="demo-stats nd-counts"></div>
      <div class="demo-callout nd-sync" hidden></div>
      <div class="nd-cards"></div>
      <section class="nd-detail" hidden aria-label="Crew day"></section>
      <div class="nd-tablewrap"><table class="demo-table"><caption class="nd-h">Today by contractor</caption>
        <thead><tr><th>Contractor</th><th class="num">Crews</th><th class="num">Installs</th><th class="num">Repairs</th><th class="num">Insp.</th><th class="num">Footage</th></tr></thead><tbody></tbody></table></div>
    </div>
  </div>
  <p class="demo-foot">Same rules as the production tool. Synthetic data, no client information.</p>`;

  const $ = s => el.querySelector(s);
  const status = $('.demo-status'), steps = el.querySelectorAll('.demo-steps li');
  const playBtn = $('[data-a=play]'), speedBtn = $('[data-a=speed]'), regSel = $('[data-a=region]');
  const scrub = $('.nd-scrub'), clock = $('.nd-clock'), detail = $('.nd-detail'), syncNote = $('.nd-sync');
  const say = msg => ctx.announce(status, msg);
  const step = i => steps[i]?.classList.add('done');

  let now = D0, playing = false, autoPaused = false, speed = 0, region = 'all', sel = null, raf = 0, lastTs = 0;
  let shownSyncs = new Set(), crews = day.crews;
  const timers = [];

  // ---- Map -----------------------------------------------------------------
  const map = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Crew map, local coordinates in feet' });
  const base = svg('g', { 'aria-hidden': 'true' });
  day.regions.forEach((r, i) => {
    base.append(svg('rect', { x: r.x, y: 0, width: r.w, height: H, class: `nd-region${i % 2 ? ' alt' : ''}`, 'data-r': r.id }));
  });
  for (let x = grid; x < W; x += grid) base.append(svg('line', { x1: x, y1: 0, x2: x, y2: H, class: x % 1000 ? 'nd-st' : 'nd-st main' }));
  for (let y = grid; y < H; y += grid) base.append(svg('line', { x1: 0, y1: y, x2: W, y2: y, class: y % 1000 ? 'nd-st' : 'nd-st main' }));
  day.regions.forEach(r => {
    if (r.x) base.append(svg('line', { x1: r.x, y1: 0, x2: r.x, y2: H, class: 'nd-border' }));
    const t = svg('text', { x: r.x + 80, y: 170, class: 'nd-rlabel' }); t.textContent = r.name.toUpperCase();
    base.append(t);
  });
  const sb = svg('g', { class: 'nd-scale' });
  sb.append(svg('line', { x1: W - 1080, y1: H - 120, x2: W - 80, y2: H - 120 }));
  const sbt = svg('text', { x: W - 580, y: H - 170, 'text-anchor': 'middle' }); sbt.textContent = '1,000 ft';
  sb.append(sbt); base.append(sb);
  const trails = svg('g'), dots = svg('g');
  map.append(base, trails, dots);
  $('.nd-map').append(map);

  const ui = new Map();
  for (const c of day.crews) {
    const trail = svg('polyline', { class: 'nd-trail', points: '' });
    const g = svg('g', { class: 'nd-dot', tabindex: '0', role: 'button' });
    g.append(svg('circle', { r: 85, class: 'nd-ring' }), svg('circle', { r: 60 }));
    const lbl = svg('text', { x: 110, y: 40 }); lbl.textContent = c.id; g.append(lbl);
    g.addEventListener('click', () => select(c.id));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.id); } });
    trails.append(trail); dots.append(g);
    const card = document.createElement('button');
    card.className = 'nd-card';
    card.innerHTML = `<span class="nd-id">${c.id}</span><span class="nd-chip"></span><span class="nd-sub">${c.regionName} · <span class="nd-ago"></span></span>`;
    card.addEventListener('click', () => select(c.id));
    $('.nd-cards').append(card);
    ui.set(c.id, { trail, g, lbl, card, chip: card.querySelector('.nd-chip'), ago: card.querySelector('.nd-ago') });
  }

  // ---- Histogram -------------------------------------------------------------
  const nBins = Math.ceil((D1 - D0) / 60);
  const hist = svg('svg', { viewBox: `0 0 ${nBins * 40} 132`, role: 'img' });
  const bars = [];
  for (let i = 0; i < nBins; i++) {
    const b = svg('rect', { x: i * 40 + 5, width: 30, y: 110, height: 0, class: 'nd-bar' });
    bars.push(b); hist.append(b);
    if (i % 3 === 0) { const t = svg('text', { x: i * 40 + 20, y: 128, 'text-anchor': 'middle' }); t.textContent = fmt(D0 + i * 60).slice(0, 2); hist.append(t); }
  }
  hist.append(svg('line', { x1: 0, x2: nBins * 40, y1: 110.5, y2: 110.5, class: 'nd-axis' }));
  $('.nd-hist').append(hist);
  let histMax = 1;

  // ---- Render ----------------------------------------------------------------
  function render() {
    const t = tick(now);
    clock.textContent = fmt(t);
    scrub.value = t;
    scrub.setAttribute('aria-valuetext', fmt(t));

    for (const c of day.crews) {
      const u = ui.get(c.id), on = crews.includes(c);
      const st = statusFor(c, t), [x, y] = position(c, t);
      u.g.setAttribute('transform', `translate(${x} ${y})`);
      const left = x > W - 700;
      u.lbl.setAttribute('x', left ? -110 : 110); u.lbl.setAttribute('text-anchor', left ? 'end' : 'start');
      u.g.setAttribute('class', `nd-dot st-${st.key}${sel === c.id ? ' sel' : ''}`);
      u.g.setAttribute('aria-label', `${c.id}, ${c.contractorName}: ${st.label}`);
      u.g.style.display = u.trail.style.display = on ? '' : 'none';
      u.card.hidden = !on;
      u.trail.setAttribute('points', [c.start, ...visible(c, t).map(e => [e.x, e.y])].map(p => p.join(',')).join(' '));
      u.trail.setAttribute('class', `nd-trail${sel === c.id ? ' sel' : ''}`);
      u.card.className = `nd-card st-${st.key}${sel === c.id ? ' sel' : ''}`;
      u.card.setAttribute('aria-pressed', String(sel === c.id));
      u.chip.textContent = st.label;
      u.ago.textContent = st.last ? `last report ${ago(st.gap)}` : `shift ${fmt(c.shift[0])}–${fmt(c.shift[1])}`;
    }
    day.regions.forEach(r => map.querySelector(`[data-r=${r.id}]`).classList.toggle('dim', region !== 'all' && region !== r.id));

    const counts = statusCounts(crews, t);
    $('.nd-counts').innerHTML = STATUS_ORDER.map(k => `<div class="st-${k}"><span>${STATUS[k]}</span><b>${counts[k]}</b></div>`).join('');

    $('tbody').innerHTML = contractorStats(crews, t, day.contractors).map(s =>
      `<tr><td title="${esc(s.name)}">${esc(s.name)}</td><td class="num">${s.crews}</td><td class="num">${s.install}</td><td class="num">${s.repair}</td><td class="num">${s.inspection}</td><td class="num">${num(s.ft)} ft</td></tr>`).join('');

    const h = hourHistogram(crews, t, day.day);
    bars.forEach((b, i) => {
      const v = (h[i] / histMax) * 100;
      b.setAttribute('y', 110 - v); b.setAttribute('height', v);
      b.classList.toggle('cur', i === Math.floor((t - D0) / 60));
    });
    hist.setAttribute('aria-label', `Reports by hour recorded: ${h.map((v, i) => `${fmt(D0 + i * 60).slice(0, 2)}h ${v}`).join(', ')}`);

    const syncs = lateSyncs(crews, t);
    syncNote.hidden = !syncs.length;
    syncNote.innerHTML = syncs.map(s => `<b>Offline sync · ${s.crew}</b>: ${s.count} reports recorded ${fmt(s.from)}–${fmt(s.to)} arrived together at ${fmt(s.at)}. They are filed under the time they were recorded, so they back-fill earlier hours of today instead of piling into ${fmt(s.at).slice(0, 2)}:00.`).join('<br>');
    for (const s of syncs) if (!shownSyncs.has(s.crew)) {
      shownSyncs.add(s.crew);
      if (playing) say(`${fmt(s.at)}: ${s.crew} synced ${s.count} offline reports from ${fmt(s.from)}–${fmt(s.to)}.`);
    }
    shownSyncs = new Set([...shownSyncs].filter(id => syncs.some(s => s.crew === id)));

    if (sel) renderDetail(t);
  }

  function renderDetail(t) {
    const c = day.crews.find(k => k.id === sel), st = statusFor(c, t), seen = visible(c, t);
    const x = m => ((m - D0) / (D1 - D0)) * 1000;
    detail.querySelector('.nd-dh').innerHTML = `<b>${c.id}</b> · ${esc(c.contractorName)} · ${c.regionName} · shift ${fmt(c.shift[0])}–${fmt(c.shift[1])} <span class="nd-chip st-${st.key}">${st.label}</span>`;
    detail.querySelector('.nd-tl').innerHTML =
      `<rect x="${x(c.shift[0])}" y="8" width="${x(c.shift[1]) - x(c.shift[0])}" height="28" class="nd-shift"/>` +
      seen.map(e => `<line x1="${x(e.t)}" x2="${x(e.t)}" y1="10" y2="34" class="tl-${e.type}${e.recv - e.t > LATE_SYNC ? ' late' : ''}"/>`).join('') +
      `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="44" class="nd-now"/>` +
      [0, 3, 6, 9, 12].map(i => `<text x="${x(D0 + i * 60)}" y="58" text-anchor="${i ? (i === 12 ? 'end' : 'middle') : 'start'}">${fmt(D0 + i * 60)}</text>`).join('');
    detail.querySelector('.nd-dsum').textContent = seen.length
      ? `${seen.length} reports · ${seen.filter(e => e.type === 'install').length} installs · ${num(seen.reduce((a, e) => a + e.ft, 0))} ft`
      : 'No reports yet today.';
    detail.querySelector('.nd-ev').innerHTML = seen.slice().reverse().map(e =>
      `<li><time>${fmt(e.t)}</time> ${TYPE_LABEL[e.type]}${e.ft ? ` · ${num(e.ft)} ft` : ''}${e.recv - e.t > LATE_SYNC ? ` <span class="nd-late">synced ${fmt(e.recv)}</span>` : ''}</li>`).join('') || '<li>Waiting for the first report…</li>';
  }

  detail.innerHTML = `<div class="nd-dhead"><p class="nd-dh"></p><button class="demo-btn" data-a="close" aria-label="Close crew timeline">✕</button></div>
    <svg class="nd-tl" viewBox="-10 0 1020 62" role="img" aria-label="Crew day timeline from 06:00 to 19:00"></svg>
    <p class="nd-dsum"></p><ol class="nd-ev"></ol>
    <div class="nd-msg"><label>Message <select data-a="msg">${data.messages.map((m, i) => `<option value="${i}">${esc(m)}</option>`).join('')}</select></label>
    <button class="demo-btn" data-a="send">✉ Message crew</button></div>`;

  function select(id) {
    sel = sel === id ? null : id;
    detail.hidden = !sel;
    if (sel) { step(1); say(`Opened ${id}'s day timeline.`); }
    render();
  }

  // ---- Clock -----------------------------------------------------------------
  const paneHidden = () => document.hidden || el.hidden;
  function frame(ts) {
    if (!playing) return;
    if (paneHidden()) { pause(); autoPaused = true; return; }
    const dt = Math.min(ts - lastTs, 250) / 1000;
    lastTs = ts;
    const prev = tick(now);
    now = Math.min(D1, now + (dt * SPEEDS[speed]) / 60);
    if (tick(now) !== prev) render();
    if (now >= D1) { pause(); say('19:00: end of the sample day. Every crew is done for the day.'); return; }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    step(0); playBtn.classList.remove('demo-pulse');
    if (now >= D1) now = D0;
    if (ctx.reduceMotion) {
      now = D1; render();
      say('Reduced motion is on, so the day jumped to its final state at 19:00. Drag the time slider to step through it.');
      return;
    }
    playing = true; autoPaused = false;
    playBtn.textContent = '❚❚ Pause'; playBtn.setAttribute('aria-pressed', 'true');
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    playing = false; cancelAnimationFrame(raf);
    playBtn.textContent = '▶ Play'; playBtn.setAttribute('aria-pressed', 'false');
  }
  const resume = () => { if (autoPaused && !paneHidden()) play(); };
  document.addEventListener('visibilitychange', resume);
  const mo = new MutationObserver(resume);
  mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });

  // ---- Controls --------------------------------------------------------------
  playBtn.addEventListener('click', () => {
    if (playing) { pause(); say(`Paused at ${fmt(tick(now))}.`); } else { play(); if (playing) say(`Playing from ${fmt(tick(now))} at ${SPEEDS[speed]}×.`); }
  });
  scrub.addEventListener('input', () => { now = +scrub.value; autoPaused = false; render(); });
  scrub.addEventListener('change', () => say(`Time set to ${fmt(now)}.`));
  speedBtn.addEventListener('click', () => {
    speed = (speed + 1) % SPEEDS.length;
    speedBtn.textContent = `${SPEEDS[speed]}×`;
    say(`Speed ${SPEEDS[speed]}×: one real second is ${SPEEDS[speed] / 60} simulated minutes.`);
  });
  regSel.addEventListener('change', () => {
    region = regSel.value;
    crews = filterCrews(day, region);
    histMax = Math.max(1, ...hourHistogram(crews, D1, day.day));
    if (sel && !crews.some(c => c.id === sel)) select(sel);
    render();
    say(`${region === 'all' ? 'All regions' : regSel.selectedOptions[0].text}: ${crews.length} crews.`);
  });
  $('[data-a=export]').addEventListener('click', () => {
    ctx.saveText('crew-day.csv', ctx.toCSV(exportRows(crews, tick(now)), CSV_COLUMNS), 'text/csv');
    step(2);
    say(`Exported crew-day.csv: ${crews.length} crews as of ${fmt(tick(now))}.`);
  });
  detail.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') { const id = sel; select(sel); ui.get(id).card.focus(); }
    if (a !== 'send') return;
    const id = sel, c = day.crews.find(k => k.id === id), i = +detail.querySelector('[data-a=msg]').value;
    const sentAt = tick(now), st = statusFor(c, sentAt);
    step(2);
    say(`${fmt(sentAt)}: message sent to ${id}: “${data.messages[i]}”`);
    timers.push(setTimeout(() => {
      if (st.key === 'working' || st.key === 'quiet') ctx.toast(`✓ ${id} acknowledged: “${data.acks[i]}”`, 4000);
      else ctx.toast(`No reply yet from ${id} (${st.label.toLowerCase()}). Message queued for their next sync.`, 4500);
    }, 3000));
  });

  histMax = Math.max(1, ...hourHistogram(crews, D1, day.day));
  render();

  return () => {
    pause(); timers.forEach(clearTimeout); mo.disconnect();
    document.removeEventListener('visibilitychange', resume);
  };
}
