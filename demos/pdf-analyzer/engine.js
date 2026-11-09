// Design PDF Analyzer engine: pure functions, no DOM. Runs in the browser and under `node --test`.
//
// Input is a "text layer": [{ id, text, x, y, w, h }] in sheet units, the same shape PyMuPDF's
// page.get_text("dict") spans reduce to. In the demo the spans come from <text> nodes of a synthetic SVG sheet.

export const TOL_FT = 10; // two methods "agree" when they are within this many feet

// Same kinds of patterns as the production tool. Python spellings are shown in the UI's "Show regex" panel.
export const PATTERNS = {
  station: /\bSTA\.?\s*(\d+)\+(\d{2})\b/g,                         // STA 12+45 -> 1245 ft
  span: /\b(\d{1,3}(?:,\d{3})+|\d{1,5})'\s*(AERIAL|UG|FIBER)\b/g,  // 245' AERIAL, 1,050' UG
  structure: /\b(P|HH)-?(\d{3,5})\b/g,                             // P-1042 pole, HH-201 handhole
  duct: /\b(\d)\s*[-x]\s*(\d(?:\.\d+)?)"\s*DUCT\b/g,                 // 2-1.25" DUCT
  footer: /\bTOTAL\s+(AERIAL|UG|ROUTE)\s*[:=]?\s*(\d{1,3}(?:,\d{3})+|\d{1,6})'/g, // TOTAL UG 1,640'
  count: /\b(POLES|HANDHOLES)\s*[:=]?\s+(\d{1,4})(?![\d"'x])/g,    // POLES 6 (not HANDHOLES 17"x30")
};

export const PY_PATTERNS = {
  station: String.raw`STA\.?\s*(\d+)\+(\d{2})`,
  span: String.raw`(\d{1,3}(?:,\d{3})+|\d{1,5})'\s*(AERIAL|UG|FIBER)`,
  structure: String.raw`\b(P|HH)-?(\d{3,5})\b`,
  duct: String.raw`(\d)\s*[-x]\s*(\d(?:\.\d+)?)"\s*DUCT`,
  footer: String.raw`TOTAL\s+(AERIAL|UG|ROUTE)\s*[:=]?\s*([\d,]+)'`,
  count: String.raw`(POLES|HANDHOLES)\s*[:=]?\s+(\d{1,4})(?![\d"'x])`,
};

const num = s => +String(s).replace(/,/g, '');
const cx = l => l.x + (l.w ?? l.text.length * 6) / 2;
export const staToFt = (a, b) => num(a) * 100 + num(b);
export const ftToSta = ft => `STA ${Math.floor(ft / 100)}+${String(Math.round(ft % 100)).padStart(2, '0')}`;

// Rebuild text lines from spans: same baseline (±3) and a horizontal gap under `gap` units.
// Footer tables put label and value in separate cells, so totals only parse on whole lines.
export function buildLines(labels, gap = 240) {
  const sorted = [...labels].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const l of sorted) {
    const row = rows.find(r => Math.abs(r.y - l.y) <= 3);
    row ? row.items.push(l) : rows.push({ y: l.y, items: [l] });
  }
  const lines = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const l of r.items) {
      const w = l.w ?? l.text.length * 6;
      if (cur && l.x - cur.end < gap) { cur.text += ' ' + l.text; cur.ids.push(l.id); cur.end = l.x + w; }
      else lines.push(cur = { text: l.text, ids: [l.id], y: r.y, x: l.x, end: l.x + w });
    }
  }
  return lines;
}

function matchSpans(labels) {
  const hits = [];
  for (const l of labels) {
    for (const kind of ['station', 'span', 'structure', 'duct']) {
      for (const m of l.text.matchAll(PATTERNS[kind])) hits.push({ id: l.id, ids: [l.id], kind, match: m[0], groups: m.slice(1), label: l });
    }
  }
  return hits;
}

function matchLines(lines) {
  const hits = [];
  for (const ln of lines) {
    for (const kind of ['footer', 'count']) {
      for (const m of ln.text.matchAll(PATTERNS[kind])) hits.push({ id: ln.ids[0], ids: ln.ids, kind, match: m[0], groups: m.slice(1) });
    }
  }
  return hits;
}

function confidence(base, agreeCount, available) {
  if (!available) return 0;
  return Math.round(base * (0.55 + 0.225 * agreeCount) * 100) / 100;
}
export const confLevel = c => (c >= 0.85 ? 'high' : c >= 0.6 ? 'med' : 'low');

export function extract(labels, { tol = TOL_FT } = {}) {
  const hits = [...matchSpans(labels), ...matchLines(buildLines(labels))];
  const by = k => hits.filter(h => h.kind === k);

  // Stations: unique values, each may appear on several labels (e.g. a match line repeats the last one).
  const staMap = new Map();
  for (const h of by('station')) {
    const ft = staToFt(...h.groups);
    h.value = ft;
    staMap.has(ft) ? staMap.get(ft).push(h.id) : staMap.set(ft, [h.id]);
  }
  const stations = [...staMap.keys()].sort((a, b) => a - b);

  // Spans, structures and ducts in drawing order (route runs left to right on every sheet).
  const spans = by('span').map(h => ({ id: h.id, ft: num(h.groups[0]), type: h.groups[1], cx: cx(h.label) })).sort((a, b) => a.cx - b.cx);
  const route = spans.filter(s => s.type !== 'FIBER');
  const structures = by('structure').map(h => ({ id: h.id, tag: h.match.toUpperCase(), type: h.groups[0] === 'P' ? 'pole' : 'handhole', cx: cx(h.label) }))
    .filter((s, i, a) => a.findIndex(o => o.tag === s.tag) === i).sort((a, b) => a.cx - b.cx);
  const ducts = by('duct').map(h => ({ id: h.id, text: h.match, count: +h.groups[0], size: +h.groups[1], cx: cx(h.label) }));

  // Per-segment cross-check: station delta vs. the span label between the same two structures.
  const nSeg = Math.max(route.length, stations.length - 1, 0);
  const segments = [];
  for (let i = 0; i < nSeg; i++) {
    const s = route[i];
    const a = stations[i], b = stations[i + 1];
    const stationFt = a != null && b != null ? b - a : null;
    const duct = s && ducts.filter(d => Math.abs(d.cx - s.cx) < 80).sort((p, q) => Math.abs(p.cx - s.cx) - Math.abs(q.cx - s.cx))[0];
    const diff = stationFt != null && s ? stationFt - s.ft : null;
    const refs = [s?.id, ...(staMap.get(a) ?? []), ...(staMap.get(b) ?? []), structures[i]?.id, structures[i + 1]?.id, duct?.id].filter(v => v != null);
    segments.push({
      seg: i + 1,
      from: structures[i]?.tag ?? null,
      to: structures[i + 1]?.tag ?? null,
      staFrom: a != null ? ftToSta(a) : null,
      staTo: b != null ? ftToSta(b) : null,
      type: s?.type ?? null,
      labelFt: s?.ft ?? null,
      stationFt,
      diffFt: diff,
      duct: duct?.text ?? null,
      status: diff == null ? 'unmatched' : Math.abs(diff) > tol ? 'mismatch' : 'ok',
      refs,
    });
  }

  // Footer summary.
  const footer = {};
  for (const h of by('footer')) footer[h.groups[0]] = num(h.groups[1]);
  const counts = {};
  for (const h of by('count')) counts[h.groups[0]] = +h.groups[1];

  // Three strategies, scored by how many of the others they agree with.
  const sumType = t => route.filter(s => s.type === t).reduce((a, s) => a + s.ft, 0);
  const aerialFt = sumType('AERIAL'), ugFt = sumType('UG');
  const methods = [
    { key: 'labels', name: 'Text-layer labels', base: 0.95, ft: route.length ? aerialFt + ugFt : null, detail: `${route.length} span labels` },
    { key: 'footer', name: 'Footer summary', base: 0.9, ft: footer.ROUTE ?? (footer.AERIAL != null || footer.UG != null ? (footer.AERIAL ?? 0) + (footer.UG ?? 0) : null), detail: Object.keys(footer).length ? `TOTAL ${Object.keys(footer).join(' / ')}` : 'no footer table' },
    { key: 'chain', name: 'Station chain', base: 0.85, ft: stations.length > 1 ? stations.at(-1) - stations[0] : null, detail: stations.length > 1 ? `${ftToSta(stations[0])} → ${ftToSta(stations.at(-1))}` : 'fewer than 2 stations' },
  ];
  for (const m of methods) {
    m.agrees = methods.filter(o => o !== m && o.ft != null && m.ft != null && Math.abs(o.ft - m.ft) <= tol).map(o => o.key);
    m.confidence = confidence(m.base, m.agrees.length, m.ft != null);
    m.level = confLevel(m.confidence);
  }
  const selected = [...methods].sort((p, q) => q.confidence - p.confidence)[0];

  // Checks and warnings.
  const poles = structures.filter(s => s.type === 'pole').length;
  const handholes = structures.filter(s => s.type === 'handhole').length;
  const checks = [];
  const check = (name, expected, found, ok = expected === found) => checks.push({ check: name, expected, found, ok });
  for (const m of methods) if (m !== selected && m.ft != null && selected.ft != null) check(`${m.name} vs ${selected.name}`, `${selected.ft} ft`, `${m.ft} ft`, Math.abs(m.ft - selected.ft) <= tol);
  if (footer.AERIAL != null) check('Footer aerial vs labels', `${footer.AERIAL} ft`, `${aerialFt} ft`, Math.abs(footer.AERIAL - aerialFt) <= tol);
  if (footer.UG != null) check('Footer UG vs labels', `${footer.UG} ft`, `${ugFt} ft`, Math.abs(footer.UG - ugFt) <= tol);
  if (counts.POLES != null) check('Pole count vs footer', counts.POLES, poles);
  if (counts.HANDHOLES != null) check('Handhole count vs footer', counts.HANDHOLES, handholes);
  check('Span labels vs station intervals', Math.max(stations.length - 1, 0), route.length);

  const warnings = [];
  const chain = methods.find(m => m.key === 'chain');
  if (chain.ft != null && selected.ft != null && chain !== selected && Math.abs(chain.ft - selected.ft) > tol) {
    const d = chain.ft - selected.ft;
    warnings.push(`Station chain is ${chain.ft.toLocaleString('en-US')} ft but ${selected.name.toLowerCase()} give ${selected.ft.toLocaleString('en-US')} ft (Δ ${d > 0 ? '+' : ''}${d} ft).`);
  }
  for (const s of segments.filter(s => s.status === 'mismatch')) {
    warnings.push(`Segment ${s.seg} (${s.from ?? '?'} → ${s.to ?? '?'}): ${s.staFrom} → ${s.staTo} spans ${s.stationFt} ft but is labelled ${s.labelFt}' ${s.type}. Check the station label at ${s.staTo}.`);
  }
  for (const c of checks.filter(c => !c.ok && !/vs (Text-layer|Footer summary|Station chain)/.test(c.check))) {
    warnings.push(`${c.check}: expected ${c.expected}, found ${c.found}.`);
  }

  const matches = {};
  for (const h of hits) matches[h.kind] = (matches[h.kind] ?? 0) + 1;

  return {
    method: { selected: selected.key, name: selected.name, confidence: selected.confidence, level: selected.level },
    methods: methods.map(({ base, ...m }) => m),
    totals: { routeFt: selected.ft, aerialFt, ugFt, poles, handholes, ducts: ducts.length, stations: stations.length },
    segments,
    structures: structures.map(({ cx, ...s }) => s),
    footer: { ...footer, ...counts },
    checks,
    warnings,
    matches,
    hits: hits.map(({ label, ...h }) => h),
  };
}

// Flatten a result for CSV export: one row per segment.
export const CSV_COLUMNS = ['seg', 'from', 'to', 'staFrom', 'staTo', 'type', 'labelFt', 'stationFt', 'diffFt', 'duct', 'status'];
