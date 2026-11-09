import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYAML, setEnabled, runSuite, layoutSVG, reportHTML, csvRows, YAMLError } from './engine.js';

const here = f => new URL(f, import.meta.url);
const data = JSON.parse(readFileSync(here('data.json'), 'utf8'));
const permits = readFileSync(here('county_permits.yaml'), 'utf8');
const osp = readFileSync(here('osp_monthly.yaml'), 'utf8');
const count = (res, rule) => res.findings.filter(f => f.rule === rule).length;

test('parseYAML handles the subset', () => {
  const doc = parseYAML(`# c\na: 1\nb: "x # not a comment"\nc:\n  d: true\n  e: [A, B, 3]\n  f:\n    - one\n    - 2\ng: bare words  # trailing\nh:\n`);
  assert.deepEqual(doc, { a: 1, b: 'x # not a comment', c: { d: true, e: ['A', 'B', 3], f: ['one', 2] }, g: 'bare words', h: null });
});

test('parseYAML reports line numbers', () => {
  assert.throws(() => parseYAML('a: 1\n  b: 2'), e => e instanceof YAMLError && e.line === 2);
  assert.throws(() => parseYAML('a: 1\na: 2'), /duplicate key/);
  assert.throws(() => parseYAML('a: [1, 2'), /unclosed/);
  assert.throws(() => parseYAML('a:\n\tb: 1'), /tabs/);
});

test('profiles parse', () => {
  const p = parseYAML(permits);
  assert.equal(p.layer, 'permit_segments');
  assert.equal(p.checks.length_mismatch.tolerance_pct, 10);
  assert.deepEqual(p.checks.domain.allowed, ['Submitted', 'Approved', 'Issued', 'Closed']);
  assert.equal(parseYAML(osp).checks.domain.enabled, false);
});

test('county_permits finds the seeded errors', () => {
  const res = runSuite(permits, data, { file: 'county_permits.yaml' });
  assert.ok(res.ok);
  assert.equal(res.stats.rows, 28);
  assert.equal(count(res, 'null_fields'), 3);
  assert.equal(count(res, 'duplicate_ids'), 4); // two IDs, each used twice
  assert.equal(count(res, 'length_mismatch'), 3); // 24%, -19%, 15%; the 8% one is inside tolerance
  assert.equal(count(res, 'orphans'), 2);
  assert.equal(count(res, 'domain'), 2);
  assert.match(res.findings.find(f => f.rule === 'domain' && /issued/.test(f.message)).message, /did you mean Issued/);
  assert.equal(res.verdict, 'FAIL');
  assert.equal(res.findings[0].severity, 'high');
});

test('editing thresholds and toggles changes the run', () => {
  const tighter = runSuite(permits.replace('tolerance_pct: 10', 'tolerance_pct: 5'), data);
  assert.equal(count(tighter, 'length_mismatch'), 4);
  const off = runSuite(setEnabled(permits, 'duplicate_ids', false), data);
  assert.equal(count(off, 'duplicate_ids'), 0);
  assert.equal(off.stats.checksRun, 4);
  const domainOn = runSuite(setEnabled(osp, 'domain', true), data);
  assert.equal(count(domainOn, 'domain'), 2);
  assert.equal(count(runSuite(osp, data), 'domain'), 0);
  const sev = runSuite(permits.replace(/severity: high/g, 'severity: low'), data);
  assert.equal(sev.stats.bySev.high, 0);
});

test('osp_monthly results', () => {
  const res = runSuite(osp, data);
  assert.equal(res.stats.rows, 32);
  assert.equal(count(res, 'null_fields'), 3);
  assert.equal(count(res, 'duplicate_ids'), 3);
  assert.equal(count(res, 'length_mismatch'), 3); // 6% one passes at ±8
  assert.equal(count(res, 'orphans'), 2);
});

test('setEnabled preserves comments and inserts when missing', () => {
  const t = setEnabled(permits, 'length_mismatch', false);
  assert.match(t, /length_mismatch:\n {4}enabled: false\n/);
  assert.match(t, /tolerance_pct: 10 {3}# try 5/);
  assert.equal(t.split('\n').length, permits.split('\n').length);
  const withComment = setEnabled('checks:\n  domain:\n    enabled: true  # keep\n', 'domain', false);
  assert.equal(withComment, 'checks:\n  domain:\n    enabled: false  # keep\n');
  const inserted = setEnabled('checks:\n  domain:\n    field: X\nother: 1\n', 'domain', true);
  assert.equal(parseYAML(inserted).checks.domain.enabled, true);
  assert.equal(parseYAML(setEnabled('layer: x\n', 'orphans', true)).checks.orphans.enabled, true);
});

test('bad config fails cleanly', () => {
  const bad = runSuite('layer: nope\n', data);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not found/);
  const broken = runSuite('checks:\n  a: [1', data);
  assert.equal(broken.ok, false);
  assert.equal(broken.steps.at(-1).level, 'err');
  const warn = runSuite(permits.replace('fields: [PERMIT_ID,', 'fields: [NOPE, PERMIT_ID,'), data);
  assert.ok(warn.steps.some(s => s.level === 'warn' && /NOPE not in schema/.test(s.text)));
});

test('step plan is monotonic and ends with a verdict', () => {
  const res = runSuite(permits, data);
  res.steps.reduce((p, s) => (assert.ok(s.at >= p), s.at), 0);
  assert.match(res.steps.at(-1).text, /^FAIL: 14 findings/);
});

test('outputs: SVG layout, CSV rows, HTML report', () => {
  const res = runSuite(permits, data);
  const svg = layoutSVG(res, data, { date: '2026-11-09' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 1100 850"/);
  assert.equal((svg.match(/data-i="/g) || []).length, 28);
  assert.match(svg, /County Permit QA/);
  assert.match(svg, /1:6,000/);
  const rows = csvRows(res);
  assert.equal(rows.length, res.findings.length);
  assert.deepEqual(Object.keys(rows[0]), ['rule', 'feature_id', 'oid', 'field', 'message', 'severity']);
  const html = reportHTML(res, svg, permits, { date: '2026-11-09' });
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);
  const xss = runSuite(permits.replace('"County Permit QA"', '"<script>x</script>"'), data);
  assert.doesNotMatch(layoutSVG(xss, data) + reportHTML(xss, '', ''), /<script>x/);
});
