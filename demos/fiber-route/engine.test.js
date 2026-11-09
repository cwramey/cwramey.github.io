// Run: node --test demos/fiber-route/engine.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, sliceLine, toLonLat, exportCSV, exportGeoJSON, exportKML, exportMarkdown, ageDays } from './engine.js';

const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
const route = id => data.routes.find(r => r.id === id).coords;
const all = new Set(data.layers.map(l => l.id));

test('Route A: low-risk downtown route, merged city corridor, full confidence', () => {
  const res = analyze(data, route('A'), all);
  assert.deepEqual(res.crossings.map(c => c.name), ['Oak Ave', 'Main St', 'SR-14', 'Elm St']);
  assert.deepEqual(res.stats.byRisk, { High: 0, Medium: 1, Low: 3 });
  assert.equal(res.corridors.length, 3); // Oak + Main merge (same owner + jurisdiction)
  assert.deepEqual(res.corridors[0].crossings, ['X1', 'X2']);
  assert.equal(res.corridors[1].permit, 'DOT encroachment permit');
  assert.ok(res.corridors.every(k => k.confidence === 1));
  assert.equal(res.quality.length, 0);
  assert.equal(res.stats.lengthFt, 800 + 1400 + 1100);
});

test('Route B: crosses river and rail (High), stale pipeline and missing owner lower confidence', () => {
  const res = analyze(data, route('B'), all);
  const names = res.crossings.map(c => c.name);
  for (const n of ['Mill River', 'Coastline mainline', 'Yard spur 4', 'Line 7 gas transmission']) assert.ok(names.includes(n), n);
  assert.equal(res.crossings.find(c => c.name === 'Mill River').risk, 'High');
  assert.equal(res.crossings.find(c => c.name === 'SR-14').jurisdiction, 'Bell County');
  const pipe = res.corridors.find(k => k.cls === 'pipeline');
  assert.equal(pipe.confidence, 0.75);
  const spur = res.corridors.find(k => k.features.includes('Yard spur 4'));
  assert.equal(spur.owner, null);
  assert.equal(spur.confidence, 0.8);
  assert.ok(res.quality.some(q => q.code === 'stale' && /Pipelines layer last edited 14 months ago/.test(q.text)));
  assert.ok(res.quality.some(q => q.code === 'owner'));
});

test('Route C: bridge polygon counted once, near-boundary penalty applies', () => {
  const res = analyze(data, route('C'), all);
  const bridge = res.crossings.filter(c => c.layer === 'bridge');
  assert.equal(bridge.length, 1);
  assert.deepEqual(bridge[0].point, [2600, 1530]);
  assert.ok(bridge[0].penalties.some(p => p.code === 'boundary'));
  assert.equal(bridge[0].confidence, 0.9);
});

test('Layer toggles remove crossings; parcels off leaves jurisdiction unresolved', () => {
  const noWater = analyze(data, route('B'), new Set([...all].filter(l => l !== 'water')));
  assert.ok(!noWater.crossings.some(c => c.layer === 'water'));
  const noParcels = analyze(data, route('A'), new Set([...all].filter(l => l !== 'parcels')));
  assert.ok(noParcels.crossings.every(c => c.jurisdiction === 'Unresolved' && c.confidence === 0.85));
  assert.ok(noParcels.quality.some(q => q.code === 'jurisdiction'));
});

test('Drawn route with no crossings yields no corridors', () => {
  const res = analyze(data, [[100, 100], [600, 200]], all);
  assert.equal(res.crossings.length, 0);
  assert.equal(res.stats.permits, 0);
});

test('helpers: sliceLine, toLonLat, ageDays', () => {
  assert.deepEqual(sliceLine([[0, 0], [100, 0], [100, 100]], 50, 150), [[50, 0], [100, 0], [100, 50]]);
  assert.deepEqual(toLonLat([0, 0], data.origin), [data.origin.lon, data.origin.lat]);
  const [lon, lat] = toLonLat([5280, 5280], data.origin);
  assert.ok(lon > data.origin.lon && lat < data.origin.lat);
  assert.ok(ageDays('2025-09-03', data.asOf) > 365);
});

test('exporters produce valid documents', () => {
  const res = analyze(data, route('B'), all);
  const gj = JSON.parse(exportGeoJSON(data, 'B', route('B'), res));
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.features.length, 1 + res.corridors.length + res.crossings.length);
  assert.ok(gj.features.every(f => f.geometry.type && f.properties.kind));
  const csv = exportCSV(res).split('\n');
  assert.equal(csv.length, res.corridors.length + 1);
  assert.match(csv[0], /^corridor,permit,risk/);
  const md = exportMarkdown(data, 'Route B', res);
  assert.match(md, /## Permit corridors/);
  assert.match(md, /Pipelines layer last edited/);
  const kml = exportKML(data, 'Route B', route('B'), res);
  assert.match(kml, /^<\?xml/);
  assert.equal((kml.match(/<Placemark>/g) || []).length, 1 + res.corridors.length + res.crossings.length);
});
