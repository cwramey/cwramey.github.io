// Canvas demo engine: fiber graph, splicing, trace, BOM and QC. Pure: no DOM, runs under node --test.
import { lineLength } from '../lib/geom.js';

// TIA-598 colour order, used for both buffer tubes and fibers within a tube.
export const TIA = [
  ['Blue', '#2f7ff0'], ['Orange', '#f28c28'], ['Green', '#2fb35a'], ['Brown', '#9a6233'],
  ['Slate', '#8a96a3'], ['White', '#f2f2f2'], ['Red', '#e53935'], ['Black', '#1b1b1b'],
  ['Yellow', '#f5d90a'], ['Violet', '#9b62e0'], ['Rose', '#f48fb1'], ['Aqua', '#26c6da'],
].map(([name, hex]) => ({ name, hex }));

export const SEVERITY = ['Blocker', 'Major', 'Minor'];

// Fiber n (1-based) in a cable with 12 fibers per buffer tube.
export function fiberColor(n) {
  const tube = Math.ceil(n / 12), pos = ((n - 1) % 12) + 1;
  return { tube, pos, tubeColor: TIA[(tube - 1) % 12], color: TIA[pos - 1] };
}
export const fiberName = (cable, n) => {
  const c = fiberColor(n);
  return `${cable} F${n} (T${c.tube} ${c.tubeColor.name} / ${c.color.name})`;
};
const key = (cable, n) => `${cable}:${n}`;
const same = (p, q) => p[0] === q[0] && p[1] === q[1];

export function createJob(data) {
  const job = JSON.parse(JSON.stringify(data));
  job.splices = job.splices.map((s, i) => ({ id: `SP-${i + 1}`, ...s }));
  job.nextSplice = job.splices.length + 1;
  return job;
}

export const cable = (job, id) => job.cables.find(c => c.id === id);
export const tray = (job, n) => job.closure.trays.find(t => t.n === n);
export const feetOf = (job, coords) => Math.round(lineLength(coords) * job.job.ftPerUnit);

// All splices touching a fiber end.
export const splicesAt = (job, cableId, n) =>
  job.splices.filter(s => (s.a[0] === cableId && s.a[1] === n) || (s.b[0] === cableId && s.b[1] === n));

// Which input fibers / output fibers belong to a tray.
export function trayFibers(job, n) {
  const t = tray(job, n), out = cable(job, t.out);
  return {
    tray: t,
    input: Array.from({ length: out.fiberCount }, (_, i) => t.inFrom + i),
    output: Array.from({ length: out.fiberCount }, (_, i) => i + 1),
  };
}

export function addSplice(job, trayN, inFiber, outFiber) {
  const t = tray(job, trayN);
  if (!t) return { ok: false, error: `No tray ${trayN} in ${job.closure.id}.` };
  if (splicesAt(job, t.in, inFiber).length) return { ok: false, error: `${t.in} F${inFiber} is already spliced.` };
  if (splicesAt(job, t.out, outFiber).length) return { ok: false, error: `${t.out} F${outFiber} is already spliced.` };
  const s = { id: `SP-${job.nextSplice++}`, tray: trayN, a: [t.in, inFiber], b: [t.out, outFiber] };
  job.splices.push(s);
  return { ok: true, splice: s };
}

export function removeSplice(job, cableId, n) {
  const before = job.splices.length;
  job.splices = job.splices.filter(s => !((s.a[0] === cableId && s.a[1] === n) || (s.b[0] === cableId && s.b[1] === n)));
  return before - job.splices.length;
}

// Splice every free input fiber to the output fiber in the same position. Returns the number added.
export function autoSplice(job, trayN) {
  const { tray: t, input, output } = trayFibers(job, trayN);
  let added = 0;
  input.forEach((f, i) => {
    if (!splicesAt(job, t.in, f).length && !splicesAt(job, t.out, output[i]).length) {
      addSplice(job, trayN, f, output[i]); added++;
    }
  });
  return added;
}

// Slice a cable's coordinates from its start up to (and including) a vertex.
function coordsTo(c, xy) {
  const i = c.coords.findIndex(p => same(p, xy));
  return c.coords.slice(0, i < 0 ? c.coords.length : i + 1);
}

// Walk the fiber graph from a drop back to the CO. Hops are returned in CO → drop order.
export function trace(job, dropId) {
  const d = job.drops.find(x => x.id === dropId);
  if (!d) return { complete: false, hops: [], path: [], message: `Unknown drop ${dropId}.` };
  const pole = job.poles.find(p => p.id === d.pole);
  const dist = cable(job, d.cable);
  const tail = [
    { featureId: dist.id, label: `${fiberName(d.cable, d.fiber)}` },
    { featureId: pole.id, label: `${pole.id}` },
    { featureId: d.id, label: `${d.label} · ${d.address}` },
  ];
  const distPath = coordsTo(dist, pole.xy);
  const path = [...distPath, ...d.coords.slice(1)];
  const sp = splicesAt(job, d.cable, d.fiber);
  if (!sp.length) {
    const t = job.closure.trays.find(x => x.out === d.cable);
    return {
      complete: false, hops: [{ featureId: job.closure.id, label: `${job.closure.id} tray ${t?.n ?? '?'} · no splice`, stop: true }, ...tail],
      path, stopAt: job.closure.id,
      message: `Trace stops at ${job.closure.id}: ${d.cable} F${d.fiber} (${fiberColor(d.fiber).color.name}) is not spliced, so ${d.label} has no light.`,
    };
  }
  const s = sp[0];
  const [inCable, inFiber] = s.a[0] === d.cable ? s.b : s.a;
  const feeder = cable(job, inCable);
  const hops = [
    { featureId: job.co.id, label: `${job.co.id} ${job.co.panel}-F${inFiber}` },
    { featureId: feeder.id, label: fiberName(inCable, inFiber) },
    { featureId: job.closure.id, label: `${job.closure.id} tray ${s.tray} · ${s.id}` },
    ...tail,
  ];
  const ft = feetOf(job, feeder.coords) + feetOf(job, distPath) + feetOf(job, d.coords);
  return {
    complete: true, hops, path: [...feeder.coords, ...path.slice(1)], lengthFt: ft,
    message: `${d.label} traced end to end: ${hops.length} hops, ${ft.toLocaleString('en-US')} ft of fiber back to ${job.co.id}.`,
  };
}

// Bill of materials from drawn geometry and placed equipment × costRates.
export function bom(job) {
  const rates = job.costRates, qty = {};
  const add = (item, q) => { qty[item] = (qty[item] || 0) + q; };
  let strand = 0;
  for (const c of job.cables) { const ft = feetOf(job, c.coords); add(c.type, ft); if (c.placement === 'Aerial') strand += ft; }
  for (const d of job.drops) add('Flat drop, 1-ct', feetOf(job, d.coords));
  add('Aerial strand + lash labour', strand);
  add(job.closure.type, 1);
  add('Fusion splice', job.splices.length);
  add('Drop install + ONT terminal', job.drops.length);
  const rows = Object.keys(rates).filter(k => qty[k]).map(item => {
    const r = rates[item], cost = Math.round(qty[item] * r.rate * 100) / 100;
    return { item, qty: qty[item], unit: r.unit, rate: r.rate, cost };
  });
  const total = Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
  const footage = rows.filter(r => r.unit === 'ft' && !/labour/i.test(r.item)).reduce((s, r) => s + r.qty, 0);
  return { rows, total, footage };
}

// ---- QC rules: each returns [{severity, featureId, message, suggestedFix}] ----
export const rules = {
  unsplicedFiber(job) {
    return job.drops.filter(d => !splicesAt(job, d.cable, d.fiber).length).map(d => {
      const t = job.closure.trays.find(x => x.out === d.cable);
      const inF = t ? t.inFrom + d.fiber - 1 : '?';
      return {
        severity: 'Blocker', featureId: d.id, rule: 'unsplicedFiber',
        message: `${d.label} is fed by ${d.cable} F${d.fiber} (${fiberColor(d.fiber).color.name}), which is not spliced at ${job.closure.id}.`,
        suggestedFix: `Splice ${t?.in ?? 'feeder'} F${inF} → ${d.cable} F${d.fiber} on tray ${t?.n ?? '?'}, or run Auto-splice 1:1.`,
      };
    });
  },
  dropTooLong(job) {
    const max = job.maxDropFt;
    return job.drops.map(d => [d, feetOf(job, d.coords)]).filter(([, ft]) => ft > max).map(([d, ft]) => ({
      severity: 'Major', featureId: d.id, rule: 'dropTooLong',
      message: `${d.label} is ${ft} ft; the limit for a flat drop is ${max} ft.`,
      suggestedFix: `Serve ${d.address} from a closer pole or add a mid-span drop clamp.`,
    }));
  },
  missingAttribute(job) {
    const out = [];
    const check = (kind, list) => list.forEach(f => (job.required[kind] || []).forEach(a => {
      if (f[a] === undefined || f[a] === null || f[a] === '') out.push({
        severity: 'Minor', featureId: f.id, rule: 'missingAttribute',
        message: `${kind[0].toUpperCase() + kind.slice(1)} ${f.id} is missing "${a}".`,
        suggestedFix: `Fill "${a}" on ${f.id} in the attribute panel.`,
      });
    }));
    check('pole', job.poles); check('drop', job.drops); check('cable', job.cables);
    return out;
  },
  doubleSplice(job) {
    const seen = new Map(), out = [];
    for (const s of job.splices) for (const end of [s.a, s.b]) {
      const k = key(...end);
      if (seen.has(k)) out.push({
        severity: 'Blocker', featureId: job.closure.id, rule: 'doubleSplice',
        message: `${end[0]} F${end[1]} is spliced twice (${seen.get(k)} and ${s.id}).`,
        suggestedFix: `Remove one of ${seen.get(k)} / ${s.id}.`,
      });
      else seen.set(k, s.id);
    }
    return out;
  },
  fiberCountMismatch(job) {
    const out = [];
    for (const c of job.cables) if (c.tubes && c.fiberCount !== c.tubes * 12) out.push({
      severity: 'Major', featureId: c.id, rule: 'fiberCountMismatch',
      message: `${c.id} says ${c.fiberCount} fibers but ${c.tubes} tube(s) × 12 = ${c.tubes * 12}.`,
      suggestedFix: `Correct fiberCount or tubes on ${c.id}.`,
    });
    for (const s of job.splices) for (const [id, n] of [s.a, s.b]) {
      const c = cable(job, id);
      if (!c || n < 1 || n > c.fiberCount) out.push({
        severity: 'Major', featureId: job.closure.id, rule: 'fiberCountMismatch',
        message: `${s.id} uses ${id} F${n}, but ${id} only has ${c ? c.fiberCount : 0} fibers.`,
        suggestedFix: `Re-terminate ${s.id} on a fiber that exists.`,
      });
    }
    return out;
  },
};

export function runQC(job) {
  const findings = Object.values(rules).flatMap(r => r(job));
  return findings.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity));
}
export const canSubmit = findings => !findings.some(f => f.severity === 'Blocker');

// One row per splice, ready for CSV.
export function spliceReport(job) {
  const servesFor = (c, n) => job.drops.filter(d => d.cable === c && d.fiber === n).map(d => d.label).join('; ');
  return [...job.splices].sort((x, y) => x.tray - y.tray || x.a[1] - y.a[1]).map(s => {
    const ca = fiberColor(s.a[1]), cb = fiberColor(s.b[1]);
    return {
      closure: job.closure.id, tray: s.tray, splice_id: s.id,
      in_cable: s.a[0], in_fiber: s.a[1], in_tube: ca.tubeColor.name, in_color: ca.color.name,
      out_cable: s.b[0], out_fiber: s.b[1], out_tube: cb.tubeColor.name, out_color: cb.color.name,
      serves: servesFor(s.b[0], s.b[1]),
    };
  });
}
