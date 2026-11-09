// GDB schema engine: validation rules and the ArcPy build-script generator. Pure, no DOM.
//
// Schema shape (see presets.json):
//   { label, gdb, wkid, srName,
//     domains: [{ name, type, kind: 'coded'|'range', desc, codes: [[code, desc]], min, max }],
//     classes: [{ name, geometry, fields: [{ name, type, length, nullable, domain }] }],
//     relationships: [{ name, origin, destination, originKey, foreignKey, cardinality }] }

export const FIELD_TYPES = ['TEXT', 'SHORT', 'LONG', 'DOUBLE', 'FLOAT', 'DATE', 'GUID'];
export const DOMAIN_TYPES = ['TEXT', 'SHORT', 'LONG', 'DOUBLE', 'FLOAT', 'DATE'];
export const GEOMETRY_TYPES = ['POINT', 'POLYLINE', 'POLYGON', 'MULTIPOINT'];
export const CARDINALITIES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY'];
const NUMERIC = new Set(['SHORT', 'LONG', 'DOUBLE', 'FLOAT']);
export const MAX_NAME = 64;
export const MAX_TEXT = 2147483647;

// System field names plus common SQL keywords that file and enterprise geodatabases refuse.
export const RESERVED = new Set([
  'OBJECTID', 'FID', 'OID', 'SHAPE', 'SHAPE_LENGTH', 'SHAPE_AREA', 'GLOBALID', 'ROWID',
  'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'BETWEEN', 'BY', 'COLUMN', 'CREATE', 'DATE',
  'DELETE', 'DESC', 'DISTINCT', 'DROP', 'EXISTS', 'FOR', 'FROM', 'GROUP', 'HAVING', 'IN', 'INDEX',
  'INSERT', 'INTO', 'IS', 'JOIN', 'KEY', 'LIKE', 'NOT', 'NULL', 'OR', 'ORDER', 'SELECT', 'SET',
  'TABLE', 'TO', 'UNION', 'UPDATE', 'USER', 'VALUES', 'VIEW', 'WHERE', 'WITH',
]);

/** Returns an error message for an invalid geodatabase name, or null when it's fine. */
export function checkName(name) {
  const s = String(name ?? '');
  if (!s.trim()) return 'Name is required';
  if (!/^[A-Za-z]/.test(s)) return 'Name must start with a letter';
  const bad = s.match(/[^A-Za-z0-9_]/);
  if (bad) return `Only letters, digits and _ are allowed (found ${bad[0] === ' ' ? 'a space' : `"${bad[0]}"`})`;
  if (s.length > MAX_NAME) return `${MAX_NAME} characters max (this is ${s.length})`;
  if (RESERVED.has(s.toUpperCase())) return `"${s}" is a reserved word`;
  return null;
}

const lower = s => String(s ?? '').toLowerCase();
const isInt = v => Number.isInteger(Number(v)) && String(v).trim() !== '';

/**
 * Validate a schema. Returns issues: { level: 'error'|'warn', scope, msg, ci?, fi?, di?, ri? }.
 * ci/fi/di/ri are indices into classes / fields / domains / relationships.
 */
export function validate(schema) {
  const out = [];
  const err = (scope, msg, at) => out.push({ level: 'error', scope, msg, ...at });
  const warn = (scope, msg, at) => out.push({ level: 'warn', scope, msg, ...at });
  const domains = schema.domains ?? [], classes = schema.classes ?? [], rels = schema.relationships ?? [];

  const seenDom = new Set();
  domains.forEach((d, di) => {
    const at = { di };
    const n = checkName(d.name);
    if (n) err('domain', `Domain "${d.name}": ${n}`, at);
    else if (seenDom.has(lower(d.name))) err('domain', `Duplicate domain name "${d.name}"`, at);
    seenDom.add(lower(d.name));
    if (!DOMAIN_TYPES.includes(d.type)) err('domain', `Domain "${d.name}": unsupported type ${d.type}`, at);
    if (d.kind === 'range') {
      if (!NUMERIC.has(d.type)) err('domain', `Range domain "${d.name}" must be numeric, not ${d.type}`, at);
      if (!(Number(d.min) < Number(d.max))) err('domain', `Range domain "${d.name}": min must be below max`, at);
    } else if (d.kind === 'coded') {
      const codes = d.codes ?? [];
      if (!codes.length) err('domain', `Coded domain "${d.name}" has no values`, at);
      const seen = new Set();
      for (const [code] of codes) {
        if (seen.has(String(code))) err('domain', `Coded domain "${d.name}": duplicate code ${code}`, at);
        seen.add(String(code));
        if (NUMERIC.has(d.type) && !Number.isFinite(Number(code))) err('domain', `Coded domain "${d.name}": code "${code}" is not a number`, at);
      }
    } else err('domain', `Domain "${d.name}": kind must be coded or range`, at);
  });
  const domByName = new Map(domains.map(d => [lower(d.name), d]));

  const seenCls = new Set();
  classes.forEach((c, ci) => {
    const n = checkName(c.name);
    if (n) err('class', `Feature class "${c.name}": ${n}`, { ci });
    else if (seenCls.has(lower(c.name))) err('class', `Duplicate feature class name "${c.name}"`, { ci });
    seenCls.add(lower(c.name));
    if (!GEOMETRY_TYPES.includes(c.geometry)) err('class', `${c.name}: unsupported geometry ${c.geometry}`, { ci });
    const seenF = new Set();
    (c.fields ?? []).forEach((f, fi) => {
      const at = { ci, fi };
      const fn = checkName(f.name);
      if (fn) err('field', fn, at);
      else if (seenF.has(lower(f.name))) err('field', `Duplicate field name "${f.name}" in ${c.name}`, at);
      seenF.add(lower(f.name));
      if (!FIELD_TYPES.includes(f.type)) err('field', `Unsupported field type ${f.type}`, at);
      if (f.type === 'TEXT' && !(isInt(f.length) && f.length >= 1 && f.length <= MAX_TEXT)) {
        err('field', 'TEXT fields need a length (whole number, 1 or more)', at);
      }
      if (f.domain) {
        const d = domByName.get(lower(f.domain));
        if (!d) err('field', `Domain "${f.domain}" does not exist`, at);
        else if (d.type !== f.type) err('field', `Domain "${d.name}" is ${d.type} but the field is ${f.type}`, at);
      }
    });
  });
  const clsByName = new Map(classes.map(c => [lower(c.name), c]));
  const fieldOf = (c, name) => c?.fields?.find(f => lower(f.name) === lower(name));

  rels.forEach((r, ri) => {
    const at = { ri };
    const n = checkName(r.name);
    if (n) err('rel', `Relationship "${r.name}": ${n}`, at);
    if (!CARDINALITIES.includes(r.cardinality)) err('rel', `${r.name}: unknown cardinality ${r.cardinality}`, at);
    const o = clsByName.get(lower(r.origin)), d = clsByName.get(lower(r.destination));
    if (!o) err('rel', `${r.name}: origin class "${r.origin}" not found`, at);
    if (!d) err('rel', `${r.name}: destination class "${r.destination}" not found`, at);
    const ok = o && fieldOf(o, r.originKey), fk = d && fieldOf(d, r.foreignKey);
    if (o && !ok) err('rel', `${r.name}: key "${r.originKey}" is missing from ${o.name}`, { ...at, ci: classes.indexOf(o) });
    if (d && !fk) err('rel', `${r.name}: key "${r.foreignKey}" is missing from ${d.name}`, { ...at, ci: classes.indexOf(d) });
    if (ok && fk && ok.type !== fk.type) {
      err('rel', `${r.name}: ${o.name}.${ok.name} is ${ok.type} but ${d.name}.${fk.name} is ${fk.type}`,
        { ...at, ci: classes.indexOf(d), fi: d.fields.indexOf(fk) });
    }
  });

  const used = new Set(classes.flatMap(c => (c.fields ?? []).map(f => lower(f.domain)).filter(Boolean)));
  domains.forEach((d, di) => { if (!used.has(lower(d.name))) warn('domain', `Domain "${d.name}" is not assigned to any field`, { di }); });
  return out;
}

export const errorCount = issues => issues.filter(i => i.level === 'error').length;

/** A field name not yet used in the class: NewField1, NewField2, ... */
export function uniqueFieldName(cls, base = 'NewField') {
  const names = new Set((cls.fields ?? []).map(f => lower(f.name)));
  let i = 1;
  while (names.has(lower(base + i))) i++;
  return base + i;
}

/** Fields that relationships use as keys, keyed "Class.Field" (lower-case). */
export function relationshipKeys(schema) {
  const s = new Set();
  for (const r of schema.relationships ?? []) {
    s.add(lower(`${r.origin}.${r.originKey}`));
    s.add(lower(`${r.destination}.${r.foreignKey}`));
  }
  return s;
}

const py = v => typeof v === 'number' ? String(v) : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Clean, portable copy of the schema for schema.json. */
export function toSchemaJSON(schema) {
  const { label, gdb, wkid, srName, domains, classes, relationships } = schema;
  return JSON.stringify({ format: 'gdb-schema/1', label, gdb, wkid, srName, domains, classes, relationships }, null, 2) + '\n';
}

/** Emit an ArcPy script that builds the schema in a new file geodatabase. Throws if there are errors. */
export function generate(schema, { outFolder = 'C:\\GIS\\Schemas' } = {}) {
  const n = errorCount(validate(schema));
  if (n) throw new Error(`Schema has ${n} error${n > 1 ? 's' : ''}; fix them before generating`);
  const nf = schema.classes.reduce((a, c) => a + c.fields.length, 0);
  const L = [
    `# build_${slug(schema.label)}.py`,
    `# Builds ${schema.gdb}: ${schema.domains.length} domains, ${schema.classes.length} feature classes, ` +
      `${nf} fields, ${schema.relationships.length} relationship classes.`,
    '# Generated by ArcGIS GDB Schema Tool (browser demo). Run with ArcGIS Pro Python (propy.bat):',
    `#   propy.bat build_${slug(schema.label)}.py [output_folder]`,
    'import os',
    'import sys',
    '',
    'import arcpy',
    '',
    `OUT_FOLDER = sys.argv[1] if len(sys.argv) > 1 else r"${outFolder}"`,
    `GDB_NAME = ${py(schema.gdb)}`,
    `SR = arcpy.SpatialReference(${Number(schema.wkid)})  # ${schema.srName ?? 'WKID ' + schema.wkid}`,
    '',
    'gdb = os.path.join(OUT_FOLDER, GDB_NAME)',
    'if arcpy.Exists(gdb):',
    '    sys.exit(f"{gdb} already exists; delete it or choose another folder")',
    'arcpy.management.CreateFileGDB(OUT_FOLDER, GDB_NAME)',
    'arcpy.env.workspace = gdb',
    '',
    '# ---- Domains ' + '-'.repeat(50),
  ];
  for (const d of schema.domains) {
    L.push(`arcpy.management.CreateDomain(gdb, ${py(d.name)}, ${py(d.desc ?? '')}, ${py(d.type)}, ${py(d.kind === 'range' ? 'RANGE' : 'CODED')})`);
    if (d.kind === 'range') {
      L.push(`arcpy.management.SetValueForRangeDomain(gdb, ${py(d.name)}, ${Number(d.min)}, ${Number(d.max)})`);
    } else {
      L.push('for code, desc in [');
      for (const [code, desc] of d.codes) L.push(`    (${py(d.type === 'TEXT' ? String(code) : Number(code))}, ${py(desc)}),`);
      L.push(']:');
      L.push(`    arcpy.management.AddCodedValueToDomain(gdb, ${py(d.name)}, code, desc)`);
    }
    L.push('');
  }
  L.push('# ---- Feature classes ' + '-'.repeat(42));
  for (const c of schema.classes) {
    L.push(`fc = ${py(c.name)}`);
    L.push(`arcpy.management.CreateFeatureclass(gdb, fc, ${py(c.geometry)}, spatial_reference=SR)`);
    for (const f of c.fields) {
      const args = [`fc, ${py(f.name)}, ${py(f.type)}`];
      if (f.type === 'TEXT') args.push(`field_length=${Number(f.length)}`);
      if (f.nullable === false) args.push('field_is_nullable="NON_NULLABLE"');
      L.push(`arcpy.management.AddField(${args.join(', ')})`);
    }
    for (const f of c.fields) if (f.domain) L.push(`arcpy.management.AssignDomainToField(fc, ${py(f.name)}, ${py(f.domain)})`);
    L.push('');
  }
  if (schema.relationships.length) L.push('# ---- Relationship classes ' + '-'.repeat(37));
  for (const r of schema.relationships) {
    L.push('arcpy.management.CreateRelationshipClass(');
    L.push(`    ${py(r.origin)}, ${py(r.destination)}, ${py(r.name)}, "SIMPLE",`);
    L.push(`    ${py(r.destination)}, ${py(r.origin)}, "NONE", ${py(r.cardinality)}, "NONE",`);
    L.push(`    ${py(r.originKey)}, ${py(r.foreignKey)})`);
  }
  if (schema.relationships.length) L.push('');
  L.push('print(f"Built {gdb}")');
  return L.join('\n') + '\n';
}

export const slug = s => String(s ?? 'schema').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'schema';
