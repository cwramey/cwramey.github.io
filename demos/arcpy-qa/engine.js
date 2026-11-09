// ArcPy Reporting & QA Suite demo engine. Pure: no DOM, runs under node --test.
// ArcPy itself can't run in a browser, so the orchestration (cursor reads, layout export) is simulated as a
// timed step plan; the QA rules themselves run for real over the synthetic feature table.
import { lineLength } from '../lib/geom.js';

export const CHECKS = ['null_fields', 'duplicate_ids', 'length_mismatch', 'orphans', 'domain'];
export const LABELS = {
  null_fields: 'Null required fields',
  duplicate_ids: 'Duplicate IDs',
  length_mismatch: 'Length mismatch vs. measured',
  orphans: 'Orphan / missing parent',
  domain: 'Invalid domain value',
};
const DEFAULT_SEV = { null_fields: 'high', duplicate_ids: 'high', length_mismatch: 'med', orphans: 'med', domain: 'low' };
const SEV_RANK = { high: 3, med: 2, low: 1 };
export const SEV_COLOR = { high: '#dc2626', med: '#d97706', low: '#059669', ok: '#64748b' };

// ---------- tiny YAML subset: nested maps, scalars, [inline, lists], "- block" lists of scalars, # comments
export class YAMLError extends Error {
  constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; }
}

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function scalar(raw, line) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const q = s[0];
  if (q === '"' || q === "'") {
    if (s.at(-1) !== q || s.length < 2) throw new YAMLError(line, 'unterminated string');
    return s.slice(1, -1);
  }
  if (q === '[') {
    if (s.at(-1) !== ']') throw new YAMLError(line, 'unclosed [ list');
    const body = s.slice(1, -1).trim();
    return body ? body.split(',').map(p => scalar(p, line)) : [];
  }
  if (q === '{') throw new YAMLError(line, 'inline {maps} are not supported in this subset');
  return s;
}

export function parseYAML(text) {
  const lines = [];
  String(text).split(/\r?\n/).forEach((raw, n) => {
    const body = stripComment(raw).replace(/\s+$/, '');
    if (!body.trim()) return;
    const lead = body.match(/^[ \t]*/)[0];
    if (lead.includes('\t')) throw new YAMLError(n + 1, 'tabs are not allowed for indentation');
    lines.push({ n: n + 1, indent: lead.length, text: body.trim() });
  });
  if (!lines.length) return {};
  let i = 0;
  function block(indent) {
    const isList = lines[i].text.startsWith('- ') || lines[i].text === '-';
    const out = isList ? [] : {};
    while (i < lines.length) {
      const L = lines[i];
      if (L.indent < indent) break;
      if (L.indent > indent) throw new YAMLError(L.n, 'unexpected indentation');
      if (isList) {
        if (!L.text.startsWith('-')) throw new YAMLError(L.n, 'expected "- item"');
        const item = L.text.slice(1).trim();
        if (/^[\w.-]+\s*:(\s|$)/.test(item)) throw new YAMLError(L.n, 'maps inside lists are not supported');
        out.push(scalar(item, L.n)); i++;
        continue;
      }
      const m = L.text.match(/^([\w.-]+)\s*:(?:\s+(.*))?$/);
      if (!m) throw new YAMLError(L.n, L.text.startsWith('-') ? 'list item where a key was expected' : 'expected "key: value"');
      if (Object.hasOwn(out, m[1])) throw new YAMLError(L.n, `duplicate key "${m[1]}"`);
      i++;
      if (m[2] === undefined || m[2] === '') {
        out[m[1]] = i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : null;
      } else out[m[1]] = scalar(m[2], L.n);
    }
    return out;
  }
  const doc = block(lines[0].indent);
  if (i < lines.length) throw new YAMLError(lines[i].n, 'unexpected indentation');
  if (Array.isArray(doc)) throw new YAMLError(lines[0].n, 'top level must be a map');
  return doc;
}

// Flip checks.<name>.enabled in the YAML text, keeping comments and layout intact.
export function setEnabled(text, check, on) {
  const lines = text.split('\n');
  const val = on ? 'true' : 'false';
  let checksIndent = -1, checkIndent = -1, lastInChecks = -1;
  for (let i = 0; i < lines.length; i++) {
    const body = stripComment(lines[i]);
    if (!body.trim()) continue;
    const indent = body.match(/^ */)[0].length;
    const key = (body.match(/^\s*([\w.-]+)\s*:/) || [])[1];
    if (checksIndent < 0) { if (key === 'checks' && indent === 0) checksIndent = indent; continue; }
    if (indent <= checksIndent) break;
    lastInChecks = i;
    if (checkIndent < 0) { if (key === check) checkIndent = indent; continue; }
    if (indent <= checkIndent) { lines.splice(i, 0, `${' '.repeat(checkIndent + 2)}enabled: ${val}`); return lines.join('\n'); }
    if (key === 'enabled') {
      lines[i] = lines[i].replace(/^(\s*enabled\s*:\s*)([^#]*?)(\s*(#.*)?)$/, `$1${val}$3`);
      return lines.join('\n');
    }
  }
  if (checkIndent >= 0) { lines.splice(lastInChecks + 1, 0, `${' '.repeat(checkIndent + 2)}enabled: ${val}`); return lines.join('\n'); }
  if (checksIndent >= 0) { lines.splice(lastInChecks < 0 ? lines.length : lastInChecks + 1, 0, `  ${check}:`, `    enabled: ${val}`); return lines.join('\n'); }
  return `${text.replace(/\n*$/, '')}\nchecks:\n  ${check}:\n    enabled: ${val}\n`;
}

// ---------- config validation
const sev = (v, fallback, warn, name) => {
  if (v == null) return fallback;
  const s = String(v).toLowerCase();
  if (s === 'medium') return 'med';
  if (SEV_RANK[s]) return s;
  warn.push(`${name}: severity "${v}" unknown, using ${fallback}`);
  return fallback;
};
const list = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function normalize(doc, data) {
  const errors = [], warnings = [];
  const layerName = doc.layer ?? Object.keys(data.layers)[0];
  const layer = data.layers[layerName];
  if (!layer) errors.push(`layer "${layerName}" not found in ${data.workspace} (have: ${Object.keys(data.layers).join(', ')})`);
  const fields = layer?.fields ?? [];
  const idField = doc.id_field ?? fields[0];
  if (layer && !fields.includes(idField)) errors.push(`id_field "${idField}" is not a field of ${layerName}`);
  const report = doc.report && typeof doc.report === 'object' ? doc.report : {};
  let scale = Number(report.map_scale ?? 6000);
  if (!(scale >= 1000 && scale <= 50000)) { warnings.push(`report.map_scale ${report.map_scale} out of range (1000–50000), using 6000`); scale = 6000; }
  const src = doc.checks && typeof doc.checks === 'object' && !Array.isArray(doc.checks) ? doc.checks : {};
  Object.keys(src).filter(k => !CHECKS.includes(k)).forEach(k => warnings.push(`checks.${k}: unknown check, ignored`));
  const checks = {};
  for (const name of CHECKS) {
    const c = src[name] && typeof src[name] === 'object' ? src[name] : {};
    const out = { enabled: src[name] != null && c.enabled !== false, severity: sev(c.severity, DEFAULT_SEV[name], warnings, `checks.${name}`) };
    if (name === 'null_fields') out.fields = list(c.fields ?? idField).map(String);
    if (name === 'length_mismatch') {
      out.field = c.field ?? null;
      out.tolerance_pct = Number(c.tolerance_pct ?? 10);
      if (!(out.tolerance_pct >= 0)) { warnings.push('checks.length_mismatch: tolerance_pct must be a number ≥ 0, using 10'); out.tolerance_pct = 10; }
    }
    if (name === 'orphans') { out.parent_field = c.parent_field ?? null; out.parent_table = c.parent_table ?? null; }
    if (name === 'domain') { out.field = c.field ?? null; out.allowed = list(c.allowed).map(String); }
    checks[name] = out;
  }
  return {
    errors, warnings, layerName, layer, idField, scale, checks,
    profile: String(doc.profile ?? 'profile'),
    title: String(report.title ?? 'QA Report'),
  };
}

// ---------- rules (each returns { findings, note, skipped? })
const blank = v => v == null || (typeof v === 'string' && v.trim() === '');
const fmt = n => Math.round(n).toLocaleString('en-US');

const RULES = {
  null_fields(c, rows, cfg) {
    const missing = c.fields.filter(f => !cfg.layer.fields.includes(f));
    const fields = c.fields.filter(f => cfg.layer.fields.includes(f));
    const findings = [];
    rows.forEach((r, i) => fields.forEach(f => {
      if (blank(r[f])) findings.push({ i, field: f, message: `${f} is ${r[f] === '' ? 'empty' : 'null'}` });
    }));
    return { findings, note: `fields=${fields.length}`, warn: missing.map(f => `null_fields: field ${f} not in schema, skipped`) };
  },
  duplicate_ids(c, rows, cfg) {
    const f = cfg.idField, seen = new Map();
    rows.forEach((r, i) => { if (!blank(r[f])) seen.set(r[f], [...(seen.get(r[f]) ?? []), i]); });
    const findings = [];
    let groups = 0;
    for (const [id, idx] of seen) {
      if (idx.length < 2) continue;
      groups++;
      idx.forEach(i => findings.push({ i, field: f, message: `${id} used by ${idx.length} features (OIDs ${idx.map(x => x + 1).join(', ')})` }));
    }
    return { findings, note: `${groups} duplicate value${groups === 1 ? '' : 's'}` };
  },
  length_mismatch(c, rows, cfg) {
    if (!c.field || !cfg.layer.fields.includes(c.field)) return { findings: [], skipped: `field ${c.field ?? '(none)'} not in schema` };
    const findings = [];
    rows.forEach((r, i) => {
      const v = r[c.field];
      if (blank(v)) return;
      const measured = lineLength(r.geometry);
      const pct = ((Number(v) - measured) / measured) * 100;
      if (Math.abs(pct) > c.tolerance_pct) findings.push({ i, field: c.field, message: `${fmt(v)} ft vs ${fmt(measured)} ft measured (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` });
    });
    return { findings, note: `tolerance ±${c.tolerance_pct}%` };
  },
  orphans(c, rows, cfg, data) {
    const parents = data.tables[c.parent_table];
    if (!parents) return { findings: [], skipped: `parent table ${c.parent_table ?? '(none)'} not found` };
    if (!c.parent_field || !cfg.layer.fields.includes(c.parent_field)) return { findings: [], skipped: `field ${c.parent_field ?? '(none)'} not in schema` };
    const set = new Set(parents.map(String)), findings = [];
    rows.forEach((r, i) => {
      const v = r[c.parent_field];
      if (!blank(v) && !set.has(String(v))) findings.push({ i, field: c.parent_field, message: `${v} not found in ${c.parent_table}` });
    });
    return { findings, note: `${c.parent_table}: ${parents.length} rows` };
  },
  domain(c, rows, cfg) {
    if (!c.field || !cfg.layer.fields.includes(c.field)) return { findings: [], skipped: `field ${c.field ?? '(none)'} not in schema` };
    if (!c.allowed.length) return { findings: [], skipped: 'no allowed values listed' };
    const ok = new Set(c.allowed), lower = new Map(c.allowed.map(a => [a.toLowerCase().trim(), a])), findings = [];
    rows.forEach((r, i) => {
      const v = r[c.field];
      if (blank(v) || ok.has(String(v))) return;
      const near = lower.get(String(v).toLowerCase().trim());
      findings.push({ i, field: c.field, message: `"${v}" not in domain${near ? ` (did you mean ${near}?)` : ''}` });
    });
    return { findings, note: `${c.allowed.length} coded values` };
  },
};

const COST = { null_fields: (n, c) => 140 + n * c.fields.length * 2, duplicate_ids: n => 120 + n * 3, length_mismatch: n => 260 + n * 11, orphans: n => 220 + n * 4, domain: n => 110 + n * 3 };

// ---------- run: returns findings, stats and a timed step plan for the view to stream
export function runSuite(source, data, { file = 'profile.yaml' } = {}) {
  const steps = [];
  let at = 0;
  const log = (ms, level, tag, text) => { at += ms; steps.push({ at, level, tag, text }); };
  log(0, 'cmd', '$', `python run_suite.py --profile ${file}`);
  let doc;
  try { doc = parseYAML(source); }
  catch (e) {
    log(90, 'err', 'config', `YAML error ${e.message}`);
    log(10, 'err', 'exit', 'aborted, exit 2');
    return { ok: false, error: e.message, steps, findings: [] };
  }
  const cfg = normalize(doc, data);
  const enabled = CHECKS.filter(k => cfg.checks[k].enabled);
  log(120, 'info', 'config', `loaded ${file}: ${enabled.length} of ${CHECKS.length} checks enabled`);
  cfg.warnings.forEach(w => log(10, 'warn', 'config', w));
  if (cfg.errors.length) {
    cfg.errors.forEach(e => log(40, 'err', 'config', e));
    log(10, 'err', 'exit', 'aborted, exit 2');
    return { ok: false, error: cfg.errors[0], steps, findings: [] };
  }
  const rows = cfg.layer.features;
  log(260, 'info', 'arcpy', `env.workspace = ${data.workspace}`);
  log(180 + rows.length * 9, 'info', 'arcpy', `da.SearchCursor("${cfg.layerName}") read ${rows.length} rows, ${cfg.layer.fields.length} fields + SHAPE@`);
  const findings = [], perCheck = {};
  for (const name of CHECKS) {
    const c = cfg.checks[name];
    if (!c.enabled) { log(20, 'dim', `qa.${name}`, 'skipped (enabled: false)'); continue; }
    const res = RULES[name](c, rows, cfg, data);
    (res.warn ?? []).forEach(w => log(10, 'warn', `qa.${name}`, w));
    if (res.skipped) { perCheck[name] = 0; log(60, 'warn', `qa.${name}`, `skipped: ${res.skipped}`); continue; }
    res.findings.forEach(f => findings.push({ rule: name, i: f.i, id: rows[f.i][cfg.idField] ?? '(null)', field: f.field, message: f.message, severity: c.severity }));
    perCheck[name] = res.findings.length;
    const n = res.findings.length;
    log(COST[name](rows.length, c), n ? 'warn' : 'ok', `qa.${name}`, `${res.note} … ${n ? `${n} found` : 'pass'}`);
  }
  findings.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.i - b.i || CHECKS.indexOf(a.rule) - CHECKS.indexOf(b.rule));
  const bySev = { high: 0, med: 0, low: 0 };
  findings.forEach(f => bySev[f.severity]++);
  const worst = new Map();
  findings.forEach(f => { if (!worst.has(f.i) || SEV_RANK[f.severity] > SEV_RANK[worst.get(f.i)]) worst.set(f.i, f.severity); });
  log(1100, 'info', 'report', `ExportToPDF qa_map_${cfg.profile}.pdf (1 page, 1:${fmt(cfg.scale)})`);
  log(180, 'info', 'report', `wrote qa-report.csv (${findings.length} rows), qa-report.html`);
  const elapsedMs = at + 40;
  const verdict = bySev.high ? 'FAIL' : findings.length ? 'WARN' : 'PASS';
  log(40, bySev.high ? 'err' : findings.length ? 'warn' : 'ok', 'done', `${verdict}: ${findings.length} findings (${bySev.high} high) in ${(elapsedMs / 1000).toFixed(2)} s`);
  return {
    ok: true, steps, findings, cfg, perCheck, worst, verdict,
    stats: { rows: rows.length, checksRun: enabled.length, findings: findings.length, bySev, flagged: worst.size, cleanPct: Math.round(((rows.length - worst.size) / rows.length) * 100), elapsedMs },
  };
}

// ---------- outputs
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CSV_COLUMNS = ['rule', 'feature_id', 'oid', 'field', 'message', 'severity'];
export const csvRows = res => res.findings.map(f => ({ rule: f.rule, feature_id: f.id, oid: f.i + 1, field: f.field, message: f.message, severity: f.severity }));

// Map-export layout as an 11x8.5 in page (100 units per inch). Feature paths carry data-i for linking.
export function layoutSVG(res, data, { date = '' } = {}) {
  const { cfg, worst, stats } = res, feats = cfg.layer.features;
  const MX = 36, MY = 36, MW = 800, MH = 560, RX = 852, u = 1200 / cfg.scale; // page units per foot
  const [x0, y0, x1, y1] = data.extent, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = x => (MX + MW / 2 + (x - cx) * u).toFixed(1), Y = y => (MY + MH / 2 - (y - cy) * u).toFixed(1);
  const t = (x, y, s, a = '') => `<text x="${x}" y="${y}"${a}>${s}</text>`;
  let grid = '';
  for (let x = x0; x <= x1; x += 400) grid += `M${X(x)} ${Y(y0)}V${Y(y1)}`;
  for (let y = y0; y <= y1; y += 400) grid += `M${X(x0)} ${Y(y)}H${X(x1)}`;
  const paths = feats.map((f, i) => {
    const s = worst.get(i), d = f.geometry.map((p, k) => `${k ? 'L' : 'M'}${X(p[0])} ${Y(p[1])}`).join('');
    return `<path data-i="${i}" class="f${s ? ` f-${s}` : ''}" d="${d}" stroke="${SEV_COLOR[s ?? 'ok']}" stroke-width="${s ? 5 : 3}"><title>OID ${i + 1} · ${esc(f[cfg.idField] ?? '(null)')}</title></path>`;
  }).join('');
  const legend = [['ok', 'No findings'], ['high', 'High'], ['med', 'Medium'], ['low', 'Low']].map(([k, label], j) =>
    `<path d="M${RX} ${330 + j * 26}h34" stroke="${SEV_COLOR[k]}" stroke-width="${k === 'ok' ? 3 : 5}"/>${t(RX + 44, 335 + j * 26, `${label} (${feats.filter((_, i) => (worst.get(i) ?? 'ok') === k).length})`)}`).join('');
  const bar = [5000, 2500, 2000, 1000, 500, 250, 200, 100].find(d => d * u <= 200) ?? 100, bw = bar * u, h = (bw / 2).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 850" role="img" aria-label="Map export layout for ${esc(cfg.title)}: ${stats.flagged} of ${stats.rows} features flagged" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#0f172a">
<rect width="1100" height="850" fill="#f8fafc"/><rect x="18" y="18" width="1064" height="814" fill="none" stroke="#0f172a" stroke-width="2"/>
<defs><clipPath id="qa-clip"><rect x="${MX}" y="${MY}" width="${MW}" height="${MH}"/></clipPath></defs><rect x="${MX}" y="${MY}" width="${MW}" height="${MH}" fill="#eef2f7"/>
<g clip-path="url(#qa-clip)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${grid}" stroke="#cbd5e1"/>${paths}</g>
<g fill="none" stroke="#0f172a"><rect x="${MX}" y="${MY}" width="${MW}" height="${MH}" stroke-width="1.5"/><path d="M${RX} 182H1062M${RX} 450H1062"/></g>
${t(RX, 40, 'QA MAP EXPORT', ' font-size="12" fill="#475569" letter-spacing="1"')}${t(RX, 70, esc(cfg.title.slice(0, 40)), ' font-size="23" font-weight="700"')}
${t(RX, 98, `Profile: ${esc(cfg.profile)}`)}${t(RX, 120, `Layer: ${esc(cfg.layerName)}`)}${t(RX, 142, `Date: ${esc(date)}`)}${t(RX, 164, `Findings: ${stats.findings} · ${stats.flagged}/${stats.rows} features`)}
<g transform="translate(957 222)"><path d="M0 -26L13 14L0 6L-13 14Z"/><path d="M0 -26L-13 14L0 6Z" fill="#f8fafc" stroke="#0f172a"/>${t(0, 36, 'N', ' text-anchor="middle" font-size="16" font-weight="700"')}</g>
${t(RX, 306, 'LEGEND', ' font-size="13" font-weight="700" letter-spacing="1"')}${legend}
<g font-size="12" fill="#475569">${t(RX, 478, 'Generated by run_suite.py')}${t(RX, 498, 'Synthetic data · local feet')}${t(MX, 700, 'Clean features drawn in grey; flagged features coloured by their worst finding.')}
${t(MX, 800, `${esc(cfg.profile)} · ${esc(data.workspace)}\\${esc(cfg.layerName)} · ${stats.checksRun} checks · ${res.verdict}`, ' font-size="11"')}</g>
<g transform="translate(${MX} 628)" font-size="13"><rect width="${h}" height="10"/><rect x="${h}" width="${h}" height="10" fill="#f8fafc" stroke="#0f172a"/>
${t(0, 30, '0')}${t(h, 30, fmt(bar / 2), ' text-anchor="middle"')}${t(bw.toFixed(1), 30, `${fmt(bar)} ft`, ' text-anchor="middle"')}${t((bw + 40).toFixed(1), 10, `1:${fmt(cfg.scale)} (1 in = ${fmt(cfg.scale / 12)} ft)`)}</g>
</svg>`;
}

// Self-contained HTML report (inline CSS, embedded SVG, no external requests).
export function reportHTML(res, svg, source, { date = '', file = '' } = {}) {
  const { cfg, stats, findings } = res;
  const col = { high: '#b91c1c', med: '#b45309', low: '#047857' };
  const rows = findings.map(f => `<tr><td>${esc(LABELS[f.rule])}</td><td>${esc(f.id)}</td><td>${f.i + 1}</td><td>${esc(f.field)}</td><td>${esc(f.message)}</td><td><b style="color:${col[f.severity]}">${f.severity.toUpperCase()}</b></td></tr>`).join('\n');
  const checks = CHECKS.map(k => `<tr><td>${LABELS[k]}</td><td>${cfg.checks[k].enabled ? (res.perCheck[k] ?? 0) : 'skipped'}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(cfg.title)} · ${esc(date)}</title>
<style>body{margin:0;padding:32px;font:14px/1.5 system-ui,sans-serif;color:#0f172a;background:#fff;max-width:1100px}h1{margin:0 0 4px}p.m{margin:0 0 20px;color:#475569}
.s{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 24px}.s div{padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px}.s b{display:block;font-size:20px}
table{border-collapse:collapse;width:100%;margin:0 0 28px}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f1f5f9}
svg{width:100%;height:auto;border:1px solid #cbd5e1}pre{padding:12px;background:#f1f5f9;border-radius:6px;overflow:auto}footer{color:#64748b;font-size:12px}</style></head>
<body><h1>${esc(cfg.title)}</h1><p class="m">Profile ${esc(file || cfg.profile)} · layer ${esc(cfg.layerName)} · ${esc(date)} · <b>${res.verdict}</b></p>
<div class="s"><div><b>${stats.rows}</b>features</div><div><b>${stats.findings}</b>findings</div><div><b>${stats.bySev.high}</b>high</div><div><b>${stats.bySev.med}</b>medium</div><div><b>${stats.bySev.low}</b>low</div><div><b>${stats.cleanPct}%</b>clean</div></div>
<h2>Checks</h2><table><tr><th>Check</th><th>Findings</th></tr>${checks}</table>
<h2>Findings</h2><table><tr><th>Rule</th><th>Feature ID</th><th>OID</th><th>Field</th><th>Message</th><th>Severity</th></tr>
${rows || '<tr><td colspan="6">No findings.</td></tr>'}</table>
<h2>Map export</h2>${svg}
<h2>Configuration</h2><pre>${esc(source)}</pre>
<footer>Generated in the browser by the ArcPy Reporting &amp; QA Suite demo. Synthetic data, no client information.</footer></body></html>`;
}
