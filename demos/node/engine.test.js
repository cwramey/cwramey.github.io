// Run: node --test demos/node/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDay, statusFor, visible, position, contractorStats, statusCounts, hourHistogram,
  lateSyncs, exportRows, filterCrews, tick, fmt, STATUS_ORDER,
} from './engine.js';

const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
const day = buildDay(data);
const crew = id => day.crews.find(c => c.id === id);
const mk = (shift, events) => ({ shift, events: events.map(([t, recv = t]) => ({ t, recv, type: 'repair', ft: 0, x: 0, y: 0 })) });

test('day shape: 3 contractors x 4 crews across 3 regions', () => {
  assert.equal(day.crews.length, 12);
  for (const c of data.contractors) assert.equal(day.crews.filter(k => k.contractor === c.id).length, 4);
  assert.equal(new Set(day.crews.map(c => c.region)).size, 3);
});

test('buildDay is deterministic', () => {
  assert.deepEqual(buildDay(data), day);
});

test('reports stay inside shift and region, in time order', () => {
  for (const c of day.crews) {
    const reg = data.regions.find(r => r.id === c.region);
    assert.ok(c.events.length > 10, `${c.id} has reports`);
    c.events.forEach((e, i) => {
      assert.ok(e.t >= c.shift[0] && e.t <= c.shift[1], `${e.id} inside shift`);
      assert.ok(e.x >= reg.x && e.x <= reg.x + reg.w, `${e.id} inside region`);
      if (i) assert.ok(e.t > c.events[i - 1].t);
      assert.ok(e.type !== 'install' ? e.ft === 0 : e.ft > 0);
    });
  }
});

test('statusFor: the documented rules', () => {
  const c = mk([420, 1020], [[500], [600]]);
  assert.equal(statusFor(c, 400).key, 'not-started');
  assert.equal(statusFor(c, 499).key, 'not-started');
  assert.equal(statusFor(c, 500).key, 'working');
  assert.equal(statusFor(c, 529.5).key, 'working');
  assert.equal(statusFor(c, 530).key, 'quiet');
  assert.equal(statusFor(c, 590).key, 'quiet');
  assert.equal(statusFor(c, 590.5).key, 'not-heard');
  assert.equal(statusFor(c, 610).key, 'working');
  assert.equal(statusFor(c, 1020).key, 'done');
  assert.equal(statusFor(mk([420, 1020], []), 1019).key, 'not-started');
});

test('statusFor ignores reports not yet received', () => {
  const c = mk([420, 1020], [[500], [520, 700]]);
  assert.equal(statusFor(c, 560).last.t, 500);
  assert.equal(statusFor(c, 560).key, 'quiet');
  assert.equal(statusFor(c, 700).last.t, 520);
});

test('offline crew goes quiet then back-fills on sync', () => {
  const b = crew('BWC-1');
  const [from, to, at] = data.crews.find(c => c.id === 'BWC-1').offline;
  assert.equal(statusFor(b, at - 1).key, 'not-heard');
  const before = visible(b, at - 1).length, after = visible(b, at).length;
  assert.ok(after - before >= 5, 'sync delivers a batch');
  assert.deepEqual(lateSyncs(day.crews, at - 1), []);
  const [s] = lateSyncs(day.crews, at);
  assert.equal(s.crew, 'BWC-1');
  assert.ok(s.from >= from && s.to <= to && s.at === at);
  assert.equal(statusFor(b, at).key, 'working');
  // back-filled reports land in the hours they were recorded, not the sync hour
  const h0 = hourHistogram([b], at - 1), h1 = hourHistogram([b], at);
  assert.ok(h1[Math.floor((from - 360) / 60)] > h0[Math.floor((from - 360) / 60)]);
});

test('every status appears at some point in the day', () => {
  const seen = new Set();
  for (let t = 360; t <= 1140; t += 0.5) for (const c of day.crews) seen.add(statusFor(c, t).key);
  assert.deepEqual([...seen].sort(), [...STATUS_ORDER].sort());
});

test('stats, counts, histogram agree', () => {
  const now = 900;
  const counts = statusCounts(day.crews, now);
  assert.equal(Object.values(counts).reduce((a, b) => a + b), 12);
  const stats = contractorStats(day.crews, now, data.contractors);
  const reports = stats.reduce((a, s) => a + s.reports, 0);
  assert.equal(reports, hourHistogram(day.crews, now).reduce((a, b) => a + b));
  assert.equal(reports, day.crews.reduce((a, c) => a + visible(c, now).length, 0));
  for (const s of stats) assert.equal(s.install + s.repair + s.inspection, s.reports);
  assert.ok(hourHistogram(day.crews, 1140).reduce((a, b) => a + b) >= reports);
});

test('region filter', () => {
  assert.equal(filterCrews(day, 'all').length, 12);
  assert.ok(filterCrews(day, 'east').every(c => c.region === 'east'));
  assert.equal(filterCrews(day, 'west').length + filterCrews(day, 'central').length + filterCrews(day, 'east').length, 12);
});

test('export rows and position', () => {
  const rows = exportRows(day.crews, 1140);
  assert.equal(rows.length, 12);
  assert.ok(rows.every(r => r.status === 'Done for the day'));
  assert.equal(rows.find(r => r.crew === 'BWC-1').late_sync_reports > 0, true);
  const c = crew('RUS-1');
  assert.deepEqual(position(c, 360), c.start);
  const last = c.events[c.events.length - 1];
  assert.deepEqual(position(c, 1140), [last.x, last.y]);
});

test('helpers', () => {
  assert.equal(fmt(360), '06:00');
  assert.equal(fmt(1139.5), '18:59');
  assert.equal(tick(600.74), 600.5);
});
