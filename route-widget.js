// === shortest_route.py widget ================================================
// Draws a small sample road network, runs Dijkstra on it step by step and
// highlights the matching lines of shortest_route.py as each phase runs.
// "Crossing penalty" adds a cost for every edge that crosses the river or rail.
(function () {
  const root = document.getElementById('route-widget');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Sample network (seeded so it looks the same on every load) ----------
  let seed = 7;
  const rnd = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const COLS = 7, ROWS = 5, SP = 110, OX = 40, OY = 40;
  const id = (r, c) => r * COLS + c;
  const nodes = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    nodes.push({ i: id(r, c), x: OX + c * SP + (rnd() - .5) * 44, y: OY + r * SP + (rnd() - .5) * 44 });
  }
  const cand = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (c < COLS - 1) cand.push([id(r, c), id(r, c + 1)]);
    if (r < ROWS - 1) cand.push([id(r, c), id(r + 1, c)]);
    if (r < ROWS - 1 && c < COLS - 1 && rnd() < .16) cand.push(rnd() < .5 ? [id(r, c), id(r + 1, c + 1)] : [id(r, c + 1), id(r + 1, c)]);
  }
  const edges = cand.filter(() => rnd() >= .14);
  const connected = () => {
    const adj = nodes.map(() => []);
    edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
    const seen = new Set([0]), q = [0];
    while (q.length) { const u = q.pop(); for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); q.push(v); } }
    return seen.size === nodes.length;
  };
  for (const e of cand) { if (connected()) break; if (!edges.includes(e)) edges.push(e); }

  const river = [[318, -10], [286, 120], [352, 250], [300, 390], [330, 530]];
  const rail = [[-10, 318], [250, 300], [480, 262], [750, 236]];
  const segX = (p, q, r, s) => {
    const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
    if (!d) return false;
    const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
    const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };
  const crosses = (a, b, line) => {
    const p = [nodes[a].x, nodes[a].y], q = [nodes[b].x, nodes[b].y];
    for (let k = 0; k < line.length - 1; k++) if (segX(p, q, line[k], line[k + 1])) return 1;
    return 0;
  };
  const E = edges.map(([a, b]) => ({
    a, b,
    len: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y),
    hz: crosses(a, b, river) + crosses(a, b, rail),
  }));
  const PENALTY = 600;
  const adjOf = mode => {
    const adj = nodes.map(() => []);
    E.forEach(e => {
      const w = e.len + (mode === 'pen' ? PENALTY * e.hz : 0);
      adj[e.a].push([e.b, w]); adj[e.b].push([e.a, w]);
    });
    return adj;
  };

  function* dijkstra(mode, A, B) {
    const adj = adjOf(mode), dist = nodes.map(() => Infinity), prev = nodes.map(() => null);
    const done = new Set(), open = new Set([A]);
    dist[A] = 0;
    while (open.size) {
      let u = -1;
      for (const v of open) if (u < 0 || dist[v] < dist[u]) u = v;
      open.delete(u); done.add(u);
      yield { done, open };
      if (u === B) break;
      for (const [v, w] of adj[u]) {
        if (done.has(v)) continue;
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; open.add(v); }
      }
    }
    const path = [];
    for (let v = B; v != null; v = prev[v]) path.unshift(v);
    return { path: path[0] === A ? path : [], done };
  }
  const solve = (mode, A, B) => { const g = dijkstra(mode, A, B); let r; while (!(r = g.next()).done); return r.value; };
  const edgeOf = (u, v) => E.find(e => (e.a === u && e.b === v) || (e.a === v && e.b === u));
  const measure = path => {
    let m = 0, h = 0;
    for (let k = 0; k < path.length - 1; k++) { const e = edgeOf(path[k], path[k + 1]); m += e.len; h += e.hz; }
    return { m, h };
  };

  // ---- Code panel -----------------------------------------------------------
  const L = [
    '<span class="k">import</span> geopandas <span class="k">as</span> gpd',
    '<span class="k">import</span> networkx <span class="k">as</span> nx',
    '<span class="k">from</span> shapely.geometry <span class="k">import</span> LineString',
    '',
    'roads = gpd.read_file(<span class="s">"roads.geojson"</span>)',
    '',
    '<span class="c"># Build a weighted road graph</span>',
    'G = nx.Graph()',
    '<span class="k">for</span> _, row <span class="k">in</span> roads.iterrows():',
    '    start, end = row.geometry.coords[0], row.geometry.coords[-1]',
    '@W',
    '',
    '<span class="c"># Find and measure the shortest route</span>',
    'path = nx.shortest_path(G, source=A, target=B, weight=<span class="s">"weight"</span>)',
    'distance = sum(G[u][v][<span class="s">"weight"</span>] <span class="k">for</span> u, v <span class="k">in</span> zip(path[:-1], path[1:]))',
    '',
    '<span class="k">print</span>(<span class="s">"Shortest route:"</span>, path)',
    '<span class="k">print</span>(<span class="s">"Total distance:"</span>, round(distance, 2), <span class="s">"meters"</span>)',
    '',
    'route = gpd.GeoDataFrame(geometry=[LineString(path)], crs=roads.crs)',
    'route.to_file(<span class="s">"shortest_route.geojson"</span>, driver=<span class="s">"GeoJSON"</span>)',
  ];
  const W = {
    len: '    G.add_edge(start, end, weight=row.geometry.length)',
    pen: '    G.add_edge(start, end, weight=row.geometry.length <span class="x">+ PENALTY * row.crossings</span>)',
  };
  const PHASES = { load: [1, 2, 3, 5], build: [8, 9, 10, 11], search: [14], measure: [15], print: [17, 18], export: [20, 21] };
  const ORDER = ['load', 'build', 'search', 'measure', 'print', 'export'];
  const codeEl = $('rw-code');
  const drawCode = mode => {
    codeEl.innerHTML = L.map((t, k) =>
      '<div class="ln" data-l="' + (k + 1) + '"><i>' + (k + 1) + '</i><span>' + (t === '@W' ? W[mode] : t) + '</span></div>').join('');
  };
  const highlight = ph => codeEl.querySelectorAll('.ln').forEach(el =>
    el.classList.toggle('on', !!ph && PHASES[ph].includes(+el.dataset.l)));

  // ---- Map ------------------------------------------------------------------
  const svg = $('rw-svg'), NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(el);
    return el;
  };
  const pts = a => a.map(p => p.join(',')).join(' ');
  mk('polyline', { points: pts(river), class: 'river' });
  mk('polyline', { points: pts(rail), class: 'ties' });
  mk('polyline', { points: pts(rail), class: 'rail' });
  mk('text', { x: 300, y: 510, class: 'tag' }).textContent = 'river';
  mk('text', { x: 620, y: 232, class: 'tag' }).textContent = 'rail';
  const gRoads = mk('g', {}), gAlt = mk('g', {}), gPath = mk('g', {}), gNodes = mk('g', {});
  E.forEach(e => mk('line', { x1: nodes[e.a].x, y1: nodes[e.a].y, x2: nodes[e.b].x, y2: nodes[e.b].y, class: 'road' + (e.hz ? ' hz' : '') }, gRoads));
  const nodeEls = nodes.map(n => {
    const g = mk('g', { class: 'node', tabindex: 0, role: 'button', 'aria-label': 'Intersection ' + (n.i + 1) }, gNodes);
    mk('circle', { cx: n.x, cy: n.y, r: 16, fill: 'transparent' }, g);
    const c = mk('circle', { cx: n.x, cy: n.y, r: 7, class: 'nd' }, g);
    g.addEventListener('click', () => pick(n.i));
    g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(n.i); } });
    return c;
  });
  const labels = {};
  const setLabel = (k, i) => {
    if (labels[k]) labels[k].remove();
    if (i == null) return;
    const n = nodes[i], g = mk('g', { 'pointer-events': 'none' }, gNodes);
    mk('circle', { cx: n.x, cy: n.y, r: 12, class: 'nd end' }, g);
    mk('text', { x: n.x, y: n.y + 4.5, 'text-anchor': 'middle', class: 'lbl' }, g).textContent = k;
    labels[k] = g;
  };
  const polyFor = path => pts(path.map(i => [nodes[i].x.toFixed(1), nodes[i].y.toFixed(1)]));
  const coords = path => path.map(i => [+nodes[i].x.toFixed(1), +nodes[i].y.toFixed(1)]);
  const plural = n => n + ' crossing' + (n === 1 ? '' : 's');

  // ---- State ----------------------------------------------------------------
  const DEFAULT_A = id(2, 0), DEFAULT_B = id(2, 6);
  let A = DEFAULT_A, B = DEFAULT_B, mode = 'len', timer = null, gen = null, phase = null, picking = false;

  const clearRun = () => {
    clearTimeout(timer); timer = null; gen = null; phase = null;
    nodeEls.forEach(c => c.classList.remove('settled', 'frontier'));
    gPath.innerHTML = ''; gAlt.innerHTML = '';
    $('rw-explored').textContent = '0'; $('rw-distance').textContent = '–'; $('rw-crossings').textContent = '–';
    $('rw-stdout').textContent = ''; $('rw-geo').textContent = ''; $('rw-cmp').textContent = '';
    highlight(null);
  };
  const paintSearch = s => {
    nodeEls.forEach((c, i) => { c.classList.toggle('settled', s.done.has(i)); c.classList.toggle('frontier', s.open.has(i)); });
    $('rw-explored').textContent = s.done.size;
  };
  const finish = res => {
    const { m, h } = measure(res.path);
    mk('polyline', { points: polyFor(res.path), class: 'path' }, gPath);
    const other = solve(mode === 'len' ? 'pen' : 'len', A, B);
    const same = other.path.join() === res.path.join();
    if (!same) mk('polyline', { points: polyFor(other.path), class: 'alt' }, gAlt);
    $('rw-distance').textContent = Math.round(m).toLocaleString() + ' m';
    $('rw-crossings').textContent = h;
    const om = measure(other.path);
    const d = mode === 'len' ? { m, h } : om, p = mode === 'len' ? om : { m, h };
    $('rw-cmp').innerHTML = same
      ? 'Both weightings choose the same route for this A → B.'
      : 'Distance only: <b>' + Math.round(d.m) + ' m, ' + plural(d.h) + '</b> · With crossing penalty: <b>' +
        Math.round(p.m) + ' m, ' + plural(p.h) + '</b>. The dashed line is the other weighting\'s route.';
    $('rw-stdout').textContent = 'Shortest route: [' + coords(res.path).map(c => '(' + c[0] + ', ' + c[1] + ')').join(', ') +
      ']\nTotal distance: ' + m.toFixed(2) + ' meters';
    $('rw-geo').textContent = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { length_m: +m.toFixed(2), crossings: h, weight: mode },
        geometry: { type: 'LineString', coordinates: coords(res.path) } }],
    }, null, 1);
  };
  function step() {
    if (!phase) { clearRun(); phase = 'load'; highlight('load'); return true; }
    if (phase === 'load') { phase = 'build'; highlight('build'); return true; }
    if (phase === 'build') { phase = 'search'; highlight('search'); gen = dijkstra(mode, A, B); }
    if (phase === 'search') {
      const r = gen.next();
      if (!r.done) { paintSearch(r.value); return true; }
      phase = 'measure'; highlight('measure'); finish(r.value); return true;
    }
    const k = ORDER.indexOf(phase);
    if (k < ORDER.length - 1) { phase = ORDER[k + 1]; highlight(phase); return true; }
    return false;
  }
  function run() {
    clearRun();
    if (reduce) { while (step()); return; }
    const tick = () => { if (step()) timer = setTimeout(tick, phase === 'search' ? 70 : 420); };
    tick();
  }
  function instant() {
    clearRun();
    const res = solve(mode, A, B);
    paintSearch({ done: res.done, open: new Set() });
    finish(res); highlight('export'); phase = 'export';
  }
  function pick(i) {
    if (!picking) {
      clearRun(); A = i; B = null; setLabel('A', A); setLabel('B', null); picking = true;
      $('rw-hint').textContent = 'Now pick a second intersection for B.';
      return;
    }
    if (i === A) return;
    B = i; setLabel('B', B); picking = false;
    $('rw-hint').textContent = 'Pick an intersection to start a new A → B.';
    run();
  }

  $('rw-run').addEventListener('click', () => { if (B != null) { picking = false; run(); } });
  $('rw-step').addEventListener('click', () => {
    if (B == null) return;
    clearTimeout(timer); timer = null;
    if (!step()) { phase = null; step(); }
  });
  $('rw-reset').addEventListener('click', () => {
    picking = false; A = DEFAULT_A; B = DEFAULT_B; mode = 'len'; $('rw-mode').value = 'len';
    setLabel('A', A); setLabel('B', B); drawCode(mode); instant();
    $('rw-hint').textContent = 'Pick an intersection to set A, then another for B.';
  });
  $('rw-mode').addEventListener('change', e => { mode = e.target.value; drawCode(mode); if (B != null) run(); });

  $('rw-nodes').textContent = nodes.length;
  $('rw-edges').textContent = E.length;
  drawCode(mode); setLabel('A', A); setLabel('B', B); instant();
})();
