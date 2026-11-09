// Fiber Route Conflict Analyzer: pure engine (no DOM). Runs in the browser and under `node --test`.
// Same model as the production tool: crossing -> risk class -> confidence -> permit corridors -> exporters.
import { dist, lineLength, lineCrossings, pointInPolygon, pointSegDist } from '../lib/geom.js';
import { toCSV, toGeoJSON, toKML } from '../lib/download.js';

export const RISK = { water: 'High', bridge: 'High', pipeline: 'High', rail: 'High', dot: 'Medium', city: 'Low', county: 'Low' };
export const RANK = { High: 3, Medium: 2, Low: 1 };
export const PERMIT = {
  water: 'Waterway crossing permit', bridge: 'Bridge attachment permit', pipeline: 'Pipeline crossing consent',
  rail: 'Railroad crossing agreement', dot: 'DOT encroachment permit', city: 'City ROW permit', county: 'County ROW permit',
};
export const PENALTY = { stale: 0.25, owner: 0.2, boundary: 0.1, jurisdiction: 0.15 };
export const STALE_DAYS = 365, NEAR_FT = 100, PAD_FT = 150;

const DAY = 86400000;
export const ageDays = (lastEdit, asOf) => Math.round((Date.parse(asOf) - Date.parse(lastEdit)) / DAY);
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;

// Sub-polyline of pts between distances d0 and d1 along it.
export function sliceLine(pts, d0, d1) {
  const out = [];
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = dist(a, b);
    const at = d => { const t = L ? (d - walked) / L : 0; return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
    if (walked + L >= d0 && walked <= d1) {
      if (!out.length) out.push(at(Math.max(d0, walked)));
      out.push(at(Math.min(d1, walked + L)));
    }
    walked += L;
  }
  return out;
}

// Crossing points of a route with one feature. Polygons count one crossing per entry.
function featureHits(route, f, kind) {
  if (kind === 'line') return lineCrossings(route, f.coords);
  const ring = [...f.ring, f.ring[0]];
  const hits = lineCrossings(route, ring);
  if (pointInPolygon(route[0], f.ring)) hits.unshift({ point: route[0], along: 0 });
  return hits.filter((_, i) => i % 2 === 0);
}

// data: parsed data.json. route: [[x,y],...]. layers: Set of enabled layer ids.
export function analyze(data, route, layers = new Set(data.layers.map(l => l.id))) {
  const length = lineLength(route);
  const zones = layers.has('parcels') ? data.layers.find(l => l.id === 'parcels').features : null;
  const zoneAt = p => zones?.find(z => pointInPolygon(p, z.ring));
  const nearLimit = p => data.cityLimit.slice(1).some((q, i) => pointSegDist(p, data.cityLimit[i], q) < NEAR_FT);

  const crossings = [];
  for (const layer of data.layers) {
    if (layer.kind === 'zones' || !layers.has(layer.id)) continue;
    const age = ageDays(layer.lastEdit, data.asOf);
    for (const f of layer.features) {
      const cls = f.cls ?? layer.cls;
      for (const hit of featureHits(route, f, layer.kind)) {
        const zone = zoneAt(hit.point);
        const penalties = [];
        if (age > STALE_DAYS) penalties.push({ code: 'stale', label: `${layer.label} layer ${Math.round(age / 30.44)} months old`, amount: PENALTY.stale });
        if (!f.owner) penalties.push({ code: 'owner', label: 'Missing owner attribute', amount: PENALTY.owner });
        if (nearLimit(hit.point)) penalties.push({ code: 'boundary', label: `Within ${NEAR_FT} ft of city limit`, amount: PENALTY.boundary });
        if (!zone) penalties.push({ code: 'jurisdiction', label: 'Jurisdiction unresolved', amount: PENALTY.jurisdiction });
        crossings.push({
          layer: layer.id, layerLabel: layer.label, featureId: f.id, name: f.name, cls, risk: RISK[cls],
          owner: f.owner || null, jurisdiction: zone?.jurisdiction ?? 'Unresolved', parcel: zone?.id ?? null,
          parcelOwner: zone?.owner ?? null, point: hit.point.map(r1), along: r1(hit.along), lastEdit: layer.lastEdit,
          penalties, confidence: r2(Math.max(0, 1 - penalties.reduce((s, p) => s + p.amount, 0))),
        });
      }
    }
  }
  crossings.sort((a, b) => a.along - b.along);
  crossings.forEach((c, i) => (c.id = `X${i + 1}`));

  // Merge consecutive crossings that share jurisdiction + owner into one permit corridor.
  const corridors = [];
  for (const c of crossings) {
    const key = `${c.jurisdiction}|${c.owner ?? '(no owner)'}`;
    const last = corridors.at(-1);
    if (last && last.key === key) { last.members.push(c); continue; }
    corridors.push({ key, members: [c] });
  }
  corridors.forEach((k, i) => {
    const m = k.members;
    const top = m.reduce((a, b) => (RANK[b.risk] > RANK[a.risk] ? b : a));
    const from = Math.max(0, m[0].along - PAD_FT), to = Math.min(length, m.at(-1).along + PAD_FT);
    const pens = new Map();
    m.forEach(c => c.penalties.forEach(p => pens.set(p.code, p)));
    Object.assign(k, {
      id: `PC-${String(i + 1).padStart(2, '0')}`, risk: top.risk, cls: top.cls, permit: PERMIT[top.cls],
      owner: top.owner, jurisdiction: top.jurisdiction, from: r1(from), to: r1(to), length: r1(to - from),
      geometry: sliceLine(route, from, to).map(p => p.map(r1)), crossings: m.map(c => c.id),
      features: [...new Set(m.map(c => c.name))], confidence: Math.min(...m.map(c => c.confidence)), penalties: [...pens.values()],
    });
    m.forEach(c => (c.corridor = k.id));
    delete k.members;
  });

  const byRisk = { High: 0, Medium: 0, Low: 0 };
  crossings.forEach(c => byRisk[c.risk]++);
  const stats = {
    lengthFt: Math.round(length), lengthMi: r2(length / 5280), crossings: crossings.length, byRisk,
    permits: corridors.length,
    confidence: corridors.length ? r2(corridors.reduce((s, c) => s + c.confidence, 0) / corridors.length) : 1,
  };
  return { length, crossings, corridors, stats, quality: quality(data, layers, crossings, corridors) };
}

function quality(data, layers, crossings, corridors) {
  const out = [];
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  for (const l of data.layers) {
    const age = ageDays(l.lastEdit, data.asOf);
    if (!layers.has(l.id) || age <= STALE_DAYS) continue;
    const n = corridors.filter(k => k.penalties.some(p => p.code === 'stale' && p.label.startsWith(l.label))).length;
    if (n) out.push({ code: 'stale', layer: l.id, corridors: n,
      text: `${l.label} layer last edited ${Math.round(age / 30.44)} months ago, so confidence is reduced on ${plural(n, 'corridor')}.` });
  }
  const noOwner = crossings.filter(c => !c.owner);
  if (noOwner.length) {
    const names = [...new Set(noOwner.map(c => `${c.name} (${c.layerLabel})`))].join(', ');
    out.push({ code: 'owner', text: `${names} has no owner attribute. Research the owner before filing ${plural(new Set(noOwner.map(c => c.corridor)).size, 'permit')}.` });
  }
  const near = crossings.filter(c => c.penalties.some(p => p.code === 'boundary'));
  if (near.length) out.push({ code: 'boundary', text: `${plural(near.length, 'crossing')} within ${NEAR_FT} ft of the city limit. Confirm which jurisdiction issues the permit.` });
  if (!layers.has('parcels') && crossings.length) out.push({ code: 'jurisdiction', text: 'Parcels layer is off, so no corridor has a resolved jurisdiction.' });
  return out;
}

// ---- Exporters ---------------------------------------------------------------------------------------------

// Local feet (y down) -> fake lon/lat around the fictional origin. Equirectangular is fine at this scale.
export function toLonLat([x, y], origin) {
  const m = 0.3048, R = 111320;
  return [
    +(origin.lon + (x * m) / (R * Math.cos((origin.lat * Math.PI) / 180))).toFixed(6),
    +(origin.lat - (y * m) / R).toFixed(6),
  ];
}

const clean = c => ({ ...c, penalties: c.penalties.map(p => p.label).join('; ') });

export function exportGeoJSON(data, name, route, res) {
  const ll = p => toLonLat(p, data.origin);
  return toGeoJSON([
    { geometry: { type: 'LineString', coordinates: route.map(ll) }, properties: { kind: 'route', name, length_ft: res.stats.lengthFt } },
    ...res.corridors.map(k => ({
      geometry: { type: 'LineString', coordinates: k.geometry.map(ll) },
      properties: { kind: 'permit_corridor', ...clean(k), geometry: undefined, crossings: k.crossings.join(' '), features: k.features.join('; ') },
    })),
    ...res.crossings.map(c => ({
      geometry: { type: 'Point', coordinates: ll(c.point) },
      properties: { kind: 'crossing', ...clean(c), point: undefined, local_x_ft: c.point[0], local_y_ft: c.point[1] },
    })),
  ]);
}

export const CSV_COLUMNS = ['corridor', 'permit', 'risk', 'owner', 'jurisdiction', 'from_ft', 'to_ft', 'length_ft', 'crossings', 'features', 'confidence', 'flags'];
export function exportCSV(res) {
  return toCSV(res.corridors.map(k => ({
    corridor: k.id, permit: k.permit, risk: k.risk, owner: k.owner ?? '', jurisdiction: k.jurisdiction,
    from_ft: k.from, to_ft: k.to, length_ft: k.length, crossings: k.crossings.join(' '), features: k.features.join('; '),
    confidence: k.confidence.toFixed(2), flags: k.penalties.map(p => p.label).join('; '),
  })), CSV_COLUMNS);
}

export function exportMarkdown(data, name, res) {
  const s = res.stats, pipe = v => String(v).replace(/\|/g, '/');
  return [
    `# Permit summary: ${name}`, '',
    `Sample data as of ${data.asOf}. Synthetic network around ${data.origin.name}; no client data.`, '',
    `- **Route length:** ${s.lengthFt.toLocaleString('en-US')} ft (${s.lengthMi} mi)`,
    `- **Crossings:** ${s.crossings} (High ${s.byRisk.High}, Medium ${s.byRisk.Medium}, Low ${s.byRisk.Low})`,
    `- **Permits required:** ${s.permits}`,
    `- **Mean corridor confidence:** ${s.confidence.toFixed(2)}`, '',
    '## Permit corridors', '',
    '| Corridor | Permit | Risk | Owner | Jurisdiction | Station (ft) | Confidence |',
    '|---|---|---|---|---|---|---|',
    ...res.corridors.map(k => `| ${k.id} | ${k.permit} | ${k.risk} | ${pipe(k.owner ?? '**missing**')} | ${pipe(k.jurisdiction)} | ${Math.round(k.from)}–${Math.round(k.to)} | ${k.confidence.toFixed(2)} |`),
    '', '## Data quality', '',
    ...(res.quality.length ? res.quality.map(q => `- ${q.text}`) : ['- No data-quality issues on this route.']),
    '', '## Crossings', '',
    ...res.crossings.map(c => `- ${c.id} @ ${Math.round(c.along)} ft: ${c.name} (${c.layerLabel}, ${c.risk}) → ${c.corridor}`),
    '',
  ].join('\n');
}

export function exportKML(data, name, route, res) {
  const ll = p => toLonLat(p, data.origin);
  return toKML(name, [
    { name, description: `${res.stats.lengthFt} ft proposed route`, coordinates: route.map(ll) },
    ...res.corridors.map(k => ({ name: `${k.id} ${k.permit}`, description: `${k.risk} risk · ${k.owner ?? 'owner missing'} · ${k.jurisdiction} · confidence ${k.confidence.toFixed(2)}`, coordinates: k.geometry.map(ll) })),
    ...res.crossings.map(c => ({ name: `${c.id} ${c.name}`, description: `${c.layerLabel} · ${c.risk} · ${c.corridor}`, coordinates: ll(c.point) })),
  ]);
}
