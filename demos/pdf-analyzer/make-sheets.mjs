// Regenerates sheet-a.svg and sheet-b.svg (synthetic telecom plan sheets). Run: node demos/pdf-analyzer/make-sheets.mjs
// Every label is a real <text> node, standing in for a PDF text layer. Presentation attributes only (no <style>),
// because the SVG is inlined into the page. All names, streets and IDs are fictional.
import { writeFileSync } from 'node:fs';

const W = 1100, H = 760, RY = 232, X0 = 90, X1 = 1000;
const INK = '#1f2328', GREY = '#8a8f98', FONT = 'Arial, Helvetica, sans-serif';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 10}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.bold ? ' font-weight="700"' : ''}${o.fill ? ` fill="${o.fill}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`;
const line = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke ?? INK}" stroke-width="${o.w ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const rect = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill ?? 'none'}" stroke="${o.stroke ?? INK}" stroke-width="${o.w ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const sta = ft => `STA ${Math.floor(ft / 100)}+${String(ft % 100).padStart(2, '0')}`;
const fmt = n => n.toLocaleString('en-US');

function sheet(cfg) {
  const total = cfg.spans.reduce((a, s) => a + s.ft, 0);
  const k = (X1 - X0) / total;
  const xs = [X0];
  cfg.spans.forEach(s => xs.push(xs.at(-1) + s.ft * k));
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${FONT}" fill="${INK}" role="img" aria-label="${esc(cfg.aria)}">`);
  o.push(rect(0, 0, W, H, { fill: '#fbfaf6', stroke: 'none' }), rect(14, 14, W - 28, H - 28, { w: 2 }), rect(20, 20, W - 40, H - 40, { w: 0.6 }));

  // Base map: parcels, right-of-way, edges of pavement, centreline, existing utilities.
  const lots = cfg.lots;
  lots.forEach((a, i) => {
    const x = 40 + i * 170;
    o.push(rect(x, 60, 150, 110, { stroke: GREY, w: 0.7 }), t(x + 75, 120, a, { anchor: 'middle', fill: GREY, size: 11 }));
    o.push(rect(x + 20, 440, 150, 100, { stroke: GREY, w: 0.7 }), t(x + 95, 495, String(+a + 1), { anchor: 'middle', fill: GREY, size: 11 }));
  });
  o.push(line(30, 180, 1070, 180, { stroke: GREY, dash: '14 4 3 4' }), line(30, 420, 1070, 420, { stroke: GREY, dash: '14 4 3 4' }));
  o.push(line(30, 280, 1070, 280, { stroke: GREY }), line(30, 360, 1070, 360, { stroke: GREY }), line(30, 320, 1070, 320, { stroke: GREY, dash: '24 8' }));
  o.push(t(560, 344, cfg.street, { anchor: 'middle', fill: GREY, size: 15, bold: true, ls: 4 }));
  o.push(t(40, 176, 'R/W', { fill: GREY, size: 9 }), t(40, 416, 'R/W', { fill: GREY, size: 9 }), t(40, 276, 'EP', { fill: GREY, size: 9 }));
  o.push(line(30, 392, 1070, 392, { stroke: '#4a7fb5', w: 0.8, dash: '6 4' }), t(980, 404, cfg.utility, { fill: '#4a7fb5', size: 9 }));

  // Proposed route.
  o.push(`<polyline points="${xs.map(x => `${x.toFixed(1)},${RY}`).join(' ')}" fill="none" stroke="#c2185b" stroke-width="2.4"${cfg.ug ? ' stroke-dasharray="10 5"' : ''}/>`);
  cfg.spans.forEach((s, i) => {
    const m = (xs[i] + xs[i + 1]) / 2;
    if (s.type === 'UG' && !cfg.ug) o.push(line(xs[i], RY, xs[i + 1], RY, { stroke: '#fbfaf6', w: 3, dash: '6 6' }));
    o.push(t(m, 212, `${s.ft}' ${s.type}`, { anchor: 'middle', size: 10.5, bold: true }));
    if (s.duct) o.push(t(m, 252, s.duct, { anchor: 'middle', size: 9.5 }));
  });
  cfg.structures.forEach((tag, i) => {
    const x = xs[i];
    o.push(tag.startsWith('HH') ? rect(x - 6, RY - 5, 12, 10, { fill: '#fbfaf6', w: 1.4 }) : `<circle cx="${x.toFixed(1)}" cy="${RY}" r="5.5" fill="#fbfaf6" stroke="${INK}" stroke-width="1.4"/>`);
    o.push(t(x, 196, tag, { anchor: 'middle', size: 10 }));
    o.push(t(x, 268, sta(cfg.stations[i]), { anchor: 'middle', size: 9.5 }));
  });
  if (cfg.matchLine) o.push(line(1040, 150, 1040, 300, { w: 1.4, dash: '18 4 4 4' }), t(1036, 146, cfg.matchLine, { anchor: 'end', size: 9, bold: true }));
  o.push(cfg.extra ?? '');

  // North arrow.
  o.push(`<path d="M1040 42 l9 26 l-9 -7 l-9 7 z" fill="${INK}"/>`, t(1040, 82, 'N', { anchor: 'middle', size: 11, bold: true }));

  // Footer: route summary table.
  o.push(line(20, 560, W - 20, 560, { w: 1.4 }), line(380, 560, 380, H - 20, { w: 1 }), line(750, 560, 750, H - 20, { w: 1.4 }));
  o.push(t(40, 584, 'ROUTE SUMMARY', { bold: true, size: 11, ls: 1 }));
  cfg.footer.forEach(([k, v], i) => {
    const y = 610 + i * 24;
    o.push(line(30, y - 16, 370, y - 16, { stroke: GREY, w: 0.6 }), t(40, y, k, { size: 10.5 }), t(262, y, v, { size: 10.5, bold: true }));
  });
  o.push(line(250, 594, 250, 594 + cfg.footer.length * 24, { stroke: GREY, w: 0.6 }));

  // General notes (deliberate near-misses for the patterns).
  o.push(t(410, 584, 'GENERAL NOTES', { bold: true, size: 11, ls: 1 }));
  cfg.notes.forEach((n, i) => o.push(t(410, 606 + i * 20, `${i + 1}. ${n}`, { size: 9.5 })));

  // Title block.
  o.push(t(770, 586, 'NORTHWIND FIBER CO.', { bold: true, size: 14, ls: 1 }));
  o.push(t(770, 606, 'MAPLE RIDGE FTTH · PHASE 2', { size: 10.5 }), t(770, 624, cfg.title, { size: 10.5, bold: true }));
  o.push(line(760, 636, W - 20, 636, { w: 0.6 }));
  o.push(t(770, 654, `SHEET ${cfg.sheet}`, { size: 10 }), t(930, 654, `SCALE: 1" = ${Math.round(100)}'`, { size: 10 }));
  o.push(t(770, 674, 'DRAWN: C.R.', { size: 10 }), t(930, 674, 'DATE: 2026-03-14', { size: 10 }));
  o.push(line(760, 686, W - 20, 686, { w: 0.6 }));
  o.push(t(770, 708, 'SYNTHETIC SAMPLE · NOT FOR CONSTRUCTION', { size: 9.5, fill: '#c2185b', bold: true }));
  o.push(t(770, 726, 'Fictional names and IDs. No client data.', { size: 9, fill: GREY }));
  o.push('</svg>');
  return o.join('\n') + '\n';
}

const stationsFrom = (start, spans) => spans.reduce((a, s) => (a.push(a.at(-1) + s.ft), a), [start]);

// Sheet A: aerial build, consistent. 5 aerial spans + 1 UG dip to a handhole.
const aSpans = [
  { ft: 245, type: 'AERIAL' }, { ft: 310, type: 'AERIAL' }, { ft: 280, type: 'AERIAL' },
  { ft: 265, type: 'AERIAL' }, { ft: 300, type: 'AERIAL' }, { ft: 220, type: 'UG', duct: '1-2" DUCT' },
];
const aSta = stationsFrom(1000, aSpans);
writeFileSync(new URL('./sheet-a.svg', import.meta.url), sheet({
  aria: 'Synthetic aerial plan sheet, Oakhaven Rd',
  street: 'OAKHAVEN RD', utility: 'EX 8" WM', title: 'OAKHAVEN RD · AERIAL', sheet: '1 OF 2',
  lots: ['1204', '1210', '1218', '1226', '1234', '1242'],
  spans: aSpans, stations: aSta,
  structures: ['P-1042', 'P-1043', 'P-1044', 'P-1045', 'P-1046', 'P-1047', 'HH-118'],
  matchLine: `MATCH LINE ${sta(aSta.at(-1))} · SEE SHEET 2`,
  footer: [['TOTAL AERIAL', "1,400'"], ['TOTAL UG', "220'"], ['TOTAL ROUTE', "1,620'"], ['POLES', '6'], ['HANDHOLES', '1']],
  notes: ['ALL AERIAL SPANS 300\' MAX UNLESS NOTED.', 'ATTACH 144F ADSS AT 12" BELOW POWER NEUTRAL.', 'RISER AT P-1047, 2" SCH 80 U-GUARD.', 'EXISTING 1-4" CONDUIT TO REMAIN.', 'LOCATE ALL UTILITIES BEFORE DIGGING.'],
}));

// Sheet B: underground build with a deliberate +50 ft error in one station label (segment 4).
const bSpans = [
  { ft: 310, type: 'UG', duct: '2-1.25" DUCT' }, { ft: 355, type: 'UG', duct: '2-1.25" DUCT' },
  { ft: 290, type: 'UG', duct: '2-1.25" DUCT' }, { ft: 340, type: 'UG', duct: '4-1.25" DUCT' },
  { ft: 345, type: 'UG', duct: '2-1.25" DUCT' },
];
const bSta = stationsFrom(3000, bSpans).map((v, i) => (i >= 4 ? v + 50 : v)); // 42+95 drawn as 43+45
writeFileSync(new URL('./sheet-b.svg', import.meta.url), sheet({
  aria: 'Synthetic underground plan sheet, Briarwood Ln',
  street: 'BRIARWOOD LN', utility: 'EX GAS', title: 'BRIARWOOD LN · UNDERGROUND', sheet: '2 OF 2', ug: true,
  lots: ['310', '318', '326', '334', '342', '350'],
  spans: bSpans, stations: bSta,
  structures: ['HH-201', 'HH-202', 'HH-203', 'HH-204', 'HH-205', 'HH-206'],
  footer: [['TOTAL UG', "1,640'"], ['TOTAL ROUTE', "1,640'"], ['POLES', '0'], ['HANDHOLES', '6']],
  notes: ['DIRECTIONAL BORE, MIN 36" COVER IN R/W.', 'HANDHOLES 17"x30"x24" TIER 15.', 'BORE UNDER DRIVEWAYS, NO OPEN CUT.', 'PULL TAPE IN ALL SPARE DUCTS.', 'RESTORE SOD WITHIN 7 DAYS.'],
  extra: t(735, 300, '4-WAY AT DRIVEWAY CROSSING', { anchor: 'middle', size: 8.5, fill: GREY }),
}));
console.log('wrote sheet-a.svg, sheet-b.svg');
