// Run: node --test demos/gdb-schema/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkName, validate, errorCount, generate, toSchemaJSON, uniqueFieldName, slug } from './engine.js';

const PRESETS = JSON.parse(readFileSync(new URL('./presets.json', import.meta.url), 'utf8'));
const fresh = key => structuredClone(PRESETS[key]);
const errs = s => validate(s).filter(i => i.level === 'error');
const fiberCable = s => s.classes.find(c => c.name === 'FiberCable');

test('both presets validate with no errors or warnings', () => {
  for (const key of Object.keys(PRESETS)) assert.deepEqual(validate(fresh(key)), [], key);
});

test('checkName rules', () => {
  assert.equal(checkName('CableID'), null);
  assert.equal(checkName('Length_ft2'), null);
  assert.match(checkName('1st_Name'), /start with a letter/);
  assert.match(checkName('_hidden'), /start with a letter/);
  assert.match(checkName('Cable ID'), /a space/);
  assert.match(checkName('Cable-ID'), /"-"/);
  assert.match(checkName(''), /required/);
  assert.equal(checkName('A'.repeat(64)), null);
  assert.match(checkName('A'.repeat(65)), /64 characters/);
  for (const w of ['OBJECTID', 'Shape', 'select', 'Shape_Length']) assert.match(checkName(w), /reserved/, w);
});

test('field-level errors carry class and field indices', () => {
  const s = fresh('fiber_osp');
  const c = fiberCable(s), ci = s.classes.indexOf(c);
  c.fields[4].name = '1st_Name';
  const e = errs(s);
  assert.equal(e.length, 1);
  assert.equal(e[0].ci, ci);
  assert.equal(e[0].fi, 4);
});

test('duplicate field names are case-insensitive', () => {
  const s = fresh('fiber_osp');
  fiberCable(s).fields.push({ name: 'cableid', type: 'TEXT', length: 10, nullable: true });
  assert.match(errs(s)[0].msg, /Duplicate field name/);
});

test('TEXT needs a positive whole-number length; other types do not', () => {
  const s = fresh('fiber_osp');
  const f = fiberCable(s).fields[0];
  for (const bad of [undefined, '', 0, -5, 2.5]) {
    f.length = bad;
    assert.match(errs(s)[0]?.msg ?? '', /TEXT fields need a length/, String(bad));
  }
  f.type = 'GUID';
  f.length = undefined;
  assert.equal(errorCount(validate(s)), 0);
});

test('domain must exist and match the field type', () => {
  const s = fresh('fiber_osp');
  const c = fiberCable(s);
  c.fields[4].domain = 'CableType'; // DOUBLE field, TEXT domain
  assert.match(errs(s)[0].msg, /is TEXT but the field is DOUBLE/);
  c.fields[4].domain = 'NoSuchDomain';
  assert.match(errs(s)[0].msg, /does not exist/);
});

test('range domains must be numeric with min < max; unused domains warn only', () => {
  const s = fresh('fiber_osp');
  const d = s.domains.find(x => x.kind === 'range');
  d.min = 900;
  assert.match(errs(s)[0].msg, /min must be below max/);
  const s2 = fresh('fiber_osp');
  fiberCable(s2).fields.forEach(f => { if (f.domain === 'CableType') delete f.domain; });
  const issues = validate(s2);
  assert.equal(errorCount(issues), 0);
  assert.equal(issues[0].level, 'warn');
  assert.match(issues[0].msg, /CableType/);
});

test('relationship keys must exist and share a type', () => {
  const s = fresh('fiber_osp');
  const sc = s.classes.find(c => c.name === 'SpliceClosure');
  sc.fields[1].type = 'LONG';
  assert.match(errs(s)[0].msg, /is TEXT but SpliceClosure.StructureID is LONG/);
  sc.fields[1].type = 'TEXT';
  sc.fields[1].name = 'StructID';
  const e = errs(s);
  assert.equal(e.length, 1);
  assert.match(e[0].msg, /key "StructureID" is missing from SpliceClosure/);
  assert.equal(e[0].ci, s.classes.indexOf(sc));
});

test('generate refuses a schema with errors', () => {
  const s = fresh('fiber_osp');
  fiberCable(s).fields[0].name = 'SHAPE';
  assert.throws(() => generate(s), /1 error/);
});

test('generated script covers every ArcPy call in order', () => {
  const s = fresh('fiber_osp');
  const py = generate(s);
  const order = ['CreateFileGDB', 'CreateDomain', 'AddCodedValueToDomain', 'SetValueForRangeDomain',
    'CreateFeatureclass', 'AddField', 'AssignDomainToField', 'CreateRelationshipClass'];
  let last = -1;
  for (const fn of order) {
    const i = py.indexOf(`arcpy.management.${fn}(`);
    assert.ok(i > -1, fn);
    if (fn !== 'SetValueForRangeDomain' && fn !== 'AddCodedValueToDomain') { assert.ok(i > last, fn); last = i; }
  }
  assert.equal((py.match(/CreateFeatureclass\(/g) || []).length, 5);
  assert.equal((py.match(/AddField\(/g) || []).length, s.classes.reduce((a, c) => a + c.fields.length, 0));
  assert.ok(py.includes('arcpy.SpatialReference(26917)'));
  assert.ok(py.includes('AddField(fc, "CableID", "TEXT", field_length=20, field_is_nullable="NON_NULLABLE")'));
  assert.ok(py.includes('AddField(fc, "MeasuredLength_ft", "DOUBLE")'));
  assert.ok(py.includes('SetValueForRangeDomain(gdb, "FiberCountRange", 1, 864)'));
  assert.ok(py.includes('(0, "Proposed"),'));
  assert.ok(py.includes('("LT", "Loose tube"),'));
  assert.ok(py.includes('"Structure", "SpliceClosure", "Structure_SpliceClosure", "SIMPLE",'));
});

test('quotes and backslashes in descriptions are escaped', () => {
  const s = fresh('small_cell');
  s.domains[0].desc = 'Pole "material" \\ type';
  assert.ok(generate(s).includes('"Pole \\"material\\" \\\\ type"'));
});

test('helpers', () => {
  const c = { fields: [{ name: 'NewField1' }, { name: 'newfield2' }] };
  assert.equal(uniqueFieldName(c), 'NewField3');
  assert.equal(slug('Fiber OSP'), 'fiber_osp');
  const j = JSON.parse(toSchemaJSON(fresh('small_cell')));
  assert.equal(j.format, 'gdb-schema/1');
  assert.equal(j.classes.length, 5);
});
