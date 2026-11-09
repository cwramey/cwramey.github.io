import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from './engine.js';

const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
const fresh = () => E.createJob(data);

test('TIA-598 colours: 12 in order, tube rolls over at 13', () => {
  assert.equal(E.TIA.length, 12);
  assert.deepEqual(E.TIA.map(c => c.name).slice(0, 4), ['Blue', 'Orange', 'Green', 'Brown']);
  const f17 = E.fiberColor(17);
  assert.equal(f17.tube, 2); assert.equal(f17.tubeColor.name, 'Orange'); assert.equal(f17.color.name, 'Slate');
  assert.equal(E.fiberColor(12).color.name, 'Aqua');
});

test('seeded job: QC finds exactly one Blocker, Submit blocked', () => {
  const f = E.runQC(fresh());
  const blockers = f.filter(x => x.severity === 'Blocker');
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].featureId, 'D-04');
  assert.equal(f[0].severity, 'Blocker', 'sorted by severity');
  assert.ok(f.some(x => x.rule === 'dropTooLong' && x.featureId === 'D-03'));
  assert.ok(f.some(x => x.rule === 'missingAttribute' && x.featureId === 'P-B2'));
  for (const x of f) for (const k of ['severity', 'featureId', 'message', 'suggestedFix']) assert.ok(x[k], k);
  assert.equal(E.canSubmit(f), false);
});

test('trace stops at an unspliced fiber, then completes once spliced', () => {
  const job = fresh();
  const t1 = E.trace(job, 'D-04');
  assert.equal(t1.complete, false);
  assert.equal(t1.stopAt, 'SC-01');
  assert.match(t1.message, /not spliced/);
  const r = E.addSplice(job, 2, 17, 5);
  assert.ok(r.ok);
  const t2 = E.trace(job, 'D-04');
  assert.equal(t2.complete, true);
  assert.equal(t2.hops[0].label, 'CO-01 P1-F17');
  assert.equal(t2.hops.at(-1).featureId, 'D-04');
  assert.ok(t2.path.length >= 6);
  assert.equal(E.canSubmit(E.runQC(job)), true);
});

test('trace of Drop 2 matches the documented hop order', () => {
  const t = E.trace(fresh(), 'D-02');
  assert.equal(t.complete, true);
  assert.deepEqual(t.hops.map(h => h.featureId), ['CO-01', 'FDR-01', 'SC-01', 'DIST-A', 'P-A2', 'D-02']);
});

test('splicing refuses a fiber that is already used; unsplice removes it', () => {
  const job = fresh();
  assert.equal(E.addSplice(job, 1, 1, 9).ok, false);
  assert.equal(E.addSplice(job, 1, 9, 1).ok, false);
  assert.equal(E.removeSplice(job, 'DIST-A', 3), 1);
  assert.equal(E.trace(job, 'D-02').complete, false);
});

test('auto-splice 1:1 fills only free pairs', () => {
  const job = fresh();
  assert.equal(E.autoSplice(job, 1), 8);
  assert.equal(E.autoSplice(job, 2), 9);
  assert.equal(job.splices.length, 24);
  assert.equal(E.autoSplice(job, 2), 0);
  assert.equal(E.rules.doubleSplice(job).length, 0);
});

test('doubleSplice and fiberCountMismatch rules fire on bad data', () => {
  const job = fresh();
  job.splices.push({ id: 'SP-X', tray: 1, a: ['FDR-01', 1], b: ['DIST-A', 13] });
  assert.equal(E.rules.doubleSplice(job).length, 1);
  assert.ok(E.rules.fiberCountMismatch(job).some(f => /only has 12/.test(f.message)));
  job.cables[1].fiberCount = 10;
  assert.ok(E.rules.fiberCountMismatch(job).some(f => f.featureId === 'DIST-A'));
});

test('BOM: footage from geometry, costs from rates, total adds up', () => {
  const job = fresh();
  const b = E.bom(job);
  const row = item => b.rows.find(r => r.item === item);
  assert.equal(row('24-ct ADSS feeder').qty, 1200);
  assert.equal(row('48-fiber dome splice closure').qty, 1);
  assert.equal(row('Fusion splice').qty, 7);
  assert.equal(row('Drop install + ONT terminal').qty, 4);
  const sum = Math.round(b.rows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
  assert.equal(b.total, sum);
  E.autoSplice(job, 1);
  assert.equal(E.bom(job).rows.find(r => r.item === 'Fusion splice').qty, 15);
});

test('splice report rows carry colours and served drops', () => {
  const rows = E.spliceReport(fresh());
  assert.equal(rows.length, 7);
  const r = rows.find(x => x.out_cable === 'DIST-A' && x.out_fiber === 3);
  assert.equal(r.out_color, 'Green');
  assert.equal(r.serves, 'Drop 2');
});
