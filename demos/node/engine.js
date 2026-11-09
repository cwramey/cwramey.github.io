// Node dispatch simulation: pure logic, no DOM. Times are minutes since midnight; positions are local feet.
import { rng } from '../lib/rng.js';

export const TYPES = ['install', 'repair', 'inspection'];
export const STATUS = {
  working: 'Working',
  quiet: 'Quiet',
  'not-heard': 'Not heard from',
  done: 'Done for the day',
  'not-started': 'Not started',
};
export const STATUS_ORDER = ['working', 'quiet', 'not-heard', 'not-started', 'done'];
export const QUIET_AFTER = 30;   // minutes since the last report
export const LOST_AFTER = 90;
export const LATE_SYNC = 15;     // received this long after it was recorded = offline sync
export const STEP = 0.5;         // the status engine runs every simulated 30 s

export const fmt = m => {
  const t = Math.round(m * 60);
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
};
export const tick = now => Math.floor(now / STEP) * STEP;

const pickType = (r, mix) => {
  let x = r();
  for (let i = 0; i < mix.length; i++) if ((x -= mix[i]) < 0) return TYPES[i];
  return TYPES[0];
};
const inGap = (t, g) => g && t >= g[0] && t < g[0] + g[1];

// Builds the seeded day: crews with their full report stream (including reports not yet received).
export function buildDay(data) {
  const { grid } = data.map;
  const contractors = Object.fromEntries(data.contractors.map(c => [c.id, c]));
  const regions = Object.fromEntries(data.regions.map(g => [g.id, g]));
  const crews = data.crews.map((cfg, i) => {
    const r = rng(data.seed + i * 101);
    const reg = regions[cfg.region], con = contractors[cfg.c];
    const [s0, s1] = cfg.shift;
    const xMin = reg.x + grid, xMax = reg.x + reg.w - grid, yMin = grid * 2, yMax = data.map.h - grid;
    const walk = (v, d, lo, hi) => (v + d < lo || v + d > hi ? v - d : v + d); // bounce off the region edge
    let [x, y] = cfg.at, t = cfg.first ?? s0 + r.int(8, 30), n = 0;
    const end = s1 - r.int(0, 25), events = [];
    while (t <= end) {
      for (const g of [cfg.lunch, cfg.gap]) if (inGap(t, g)) t = g[0] + g[1] + r.int(1, 5);
      if (t > end) break;
      const px = x, py = y, len = grid * r.int(1, 3), dir = r.int(0, 3);
      if (dir < 2) x = walk(x, dir ? len : -len, xMin, xMax);
      else y = walk(y, dir === 3 ? len : -len, yMin, yMax);
      const type = pickType(r, con.mix);
      const off = cfg.offline && t >= cfg.offline[0] && t <= cfg.offline[1];
      events.push({
        id: `${cfg.id}-${++n}`, t, recv: off ? cfg.offline[2] : t + r.int(5, 20) / 60,
        type, x, y, ft: type === 'install' ? Math.max(grid, Math.abs(x - px) + Math.abs(y - py)) : 0,
      });
      t += r.int(5, 20);
    }
    return { id: cfg.id, contractor: con.id, contractorName: con.name, region: reg.id, regionName: reg.name, shift: cfg.shift, start: cfg.at, events };
  });
  return { date: data.date, day: data.day, contractors: data.contractors, regions: data.regions, crews };
}

// Reports the dispatcher can see at `now`: recorded and received by then.
export const visible = (crew, now) => crew.events.filter(e => e.recv <= now && e.t <= now);

// The documented status rules.
export function statusFor(crew, now) {
  const seen = visible(crew, now);
  const last = seen[seen.length - 1] ?? null;
  const gap = last ? now - last.t : null;
  let key;
  if (now >= crew.shift[1]) key = 'done';
  else if (!last) key = 'not-started';
  else if (gap < QUIET_AFTER) key = 'working';
  else if (gap <= LOST_AFTER) key = 'quiet';
  else key = 'not-heard';
  return { key, label: STATUS[key], last, gap };
}

export const position = (crew, now) => {
  const seen = visible(crew, now);
  const e = seen[seen.length - 1];
  return e ? [e.x, e.y] : crew.start;
};

export const filterCrews = (day, region) => (region && region !== 'all' ? day.crews.filter(c => c.region === region) : day.crews);

function tally(events) {
  const s = { reports: events.length, install: 0, repair: 0, inspection: 0, ft: 0 };
  for (const e of events) { s[e.type]++; s.ft += e.ft; }
  return s;
}

export function contractorStats(crews, now, contractors) {
  return contractors.map(c => {
    const mine = crews.filter(k => k.contractor === c.id);
    return { id: c.id, name: c.name, crews: mine.length, ...tally(mine.flatMap(k => visible(k, now))) };
  }).filter(s => s.crews);
}

export function statusCounts(crews, now) {
  const out = Object.fromEntries(STATUS_ORDER.map(k => [k, 0]));
  for (const c of crews) out[statusFor(c, now).key]++;
  return out;
}

// Reports per hour of the recorded time (not the receive time), 06:00–18:59.
export function hourHistogram(crews, now, [d0, d1] = [360, 1140]) {
  const bins = new Array(Math.ceil((d1 - d0) / 60)).fill(0);
  for (const c of crews) for (const e of visible(c, now)) {
    const h = Math.floor((e.t - d0) / 60);
    if (h >= 0 && h < bins.length) bins[h]++;
  }
  return bins;
}

// Groups of reports that arrived late in one offline sync, once that sync has happened.
export function lateSyncs(crews, now) {
  const out = [];
  for (const c of crews) {
    const late = c.events.filter(e => e.recv - e.t > LATE_SYNC && e.recv <= now);
    if (late.length) out.push({ crew: c.id, count: late.length, from: late[0].t, to: late[late.length - 1].t, at: late[0].recv });
  }
  return out;
}

export function crewDay(crew, now) {
  const seen = visible(crew, now);
  const st = statusFor(crew, now);
  const s = tally(seen);
  return {
    crew: crew.id, contractor: crew.contractorName, region: crew.regionName,
    shift_start: fmt(crew.shift[0]), shift_end: fmt(crew.shift[1]),
    first_report: seen[0] ? fmt(seen[0].t) : '', last_report: st.last ? fmt(st.last.t) : '',
    reports: s.reports, installs: s.install, repairs: s.repair, inspections: s.inspection, footage_ft: s.ft,
    late_sync_reports: seen.filter(e => e.recv - e.t > LATE_SYNC).length,
    status: st.label, as_of: fmt(now),
  };
}

export const CSV_COLUMNS = ['crew', 'contractor', 'region', 'shift_start', 'shift_end', 'first_report', 'last_report',
  'reports', 'installs', 'repairs', 'inspections', 'footage_ft', 'late_sync_reports', 'status', 'as_of'];
export const exportRows = (crews, now) => crews.map(c => crewDay(c, now));
