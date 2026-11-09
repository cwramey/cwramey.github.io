// Run: node --test demos/pdf-analyzer/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract, buildLines, staToFt, ftToSta, PATTERNS } from './engine.js';

// Minimal SVG text-layer reader for tests: approximates each span's box the way getBBox would.
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function textLayer(file) {
  const svg = readFileSync(new URL(file, import.meta.url), 'utf8');
  return [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m, id) => {
    const attr = k => m[1].match(new RegExp(`${k}="([^"]*)"`))?.[1];
    const size = +(attr('font-size') ?? 10), text = unesc(m[2]), w = text.length * size * 0.56;
    const anchor = attr('text-anchor');
    const x = +attr('x') - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0);
    return { id, text, x, y: +attr('y'), w, h: size };
  });
}

test('station notation converts both ways', () => {
  assert.equal(staToFt('12', '45'), 1245);
  assert.equal(ftToSta(1245), 'STA 12+45');
  assert.equal(ftToSta(1000), 'STA 10+00');
});

test('patterns match the intended labels and skip near-misses', () => {
  const all = (re, s) => [...s.matchAll(re)].map(m => m[0]);
  assert.deepEqual(all(PATTERNS.span, "245' AERIAL"), ["245' AERIAL"]);
  assert.deepEqual(all(PATTERNS.span, "1,050' UG"), ["1,050' UG"]);
  assert.deepEqual(all(PATTERNS.span, "ALL AERIAL SPANS 300' MAX"), []);
  assert.deepEqual(all(PATTERNS.duct, '2-1.25" DUCT'), ['2-1.25" DUCT']);
  assert.deepEqual(all(PATTERNS.duct, 'EXISTING 1-4" CONDUIT'), []);
  assert.deepEqual(all(PATTERNS.structure, 'P-1042 HH-201 P1'), ['P-1042', 'HH-201']);
  assert.deepEqual(all(PATTERNS.count, 'HANDHOLES 17"x30"x24" TIER 15'), []);
  assert.deepEqual(all(PATTERNS.count, 'POLES 6'), ['POLES 6']);
});

test('buildLines joins table cells on one baseline', () => {
  const lines = buildLines([
    { id: 0, text: 'TOTAL UG', x: 40, y: 610, w: 50 },
    { id: 1, text: "1,640'", x: 325, y: 610, w: 35 },
    { id: 2, text: 'unrelated', x: 40, y: 700, w: 40 },
  ]);
  assert.equal(lines[0].text, "TOTAL UG 1,640'");
  assert.deepEqual(lines[0].ids, [0, 1]);
});

test('sheet A: all three strategies agree', () => {
  const r = extract(textLayer('./sheet-a.svg'));
  assert.equal(r.totals.routeFt, 1620);
  assert.equal(r.totals.aerialFt, 1400);
  assert.equal(r.totals.ugFt, 220);
  assert.equal(r.totals.poles, 6);
  assert.equal(r.totals.handholes, 1);
  assert.equal(r.totals.ducts, 1);
  assert.equal(r.method.selected, 'labels');
  assert.equal(r.method.level, 'high');
  for (const m of r.methods) assert.equal(m.ft, 1620, m.key);
  assert.equal(r.segments.length, 6);
  assert.ok(r.segments.every(s => s.status === 'ok'));
  assert.equal(r.segments[0].from, 'P-1042');
  assert.equal(r.segments[5].to, 'HH-118');
  assert.equal(r.segments[5].duct, '1-2" DUCT');
  assert.deepEqual(r.warnings, []);
  assert.ok(r.checks.every(c => c.ok));
  assert.equal(r.footer.POLES, 6);
});

test('sheet B: the seeded 50 ft station error is caught and localised', () => {
  const r = extract(textLayer('./sheet-b.svg'));
  const by = Object.fromEntries(r.methods.map(m => [m.key, m]));
  assert.equal(by.labels.ft, 1640);
  assert.equal(by.footer.ft, 1640);
  assert.equal(by.chain.ft, 1690);
  assert.deepEqual(by.chain.agrees, []);
  assert.equal(r.method.selected, 'labels');
  assert.equal(r.footer.HANDHOLES, 6, 'note "HANDHOLES 17"x30"" must not be read as a count');
  const bad = r.segments.filter(s => s.status === 'mismatch');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].seg, 4);
  assert.equal(bad[0].diffFt, 50);
  assert.equal(bad[0].staTo, 'STA 43+45');
  assert.equal(bad[0].duct, '4-1.25" DUCT');
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /Δ \+50 ft/);
  assert.equal(r.totals.ducts, 5);
});

test('empty input degrades gracefully', () => {
  const r = extract([]);
  assert.equal(r.totals.routeFt, null);
  assert.equal(r.method.confidence, 0);
  assert.deepEqual(r.segments, []);
});
