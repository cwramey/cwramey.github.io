// Planar geometry helpers for demo engines. Coordinates are [x, y] in a local projected space (feet).
// Pure functions, no DOM: safe to import from engine.js and from node --test.

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const lineLength = pts => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

// Proper intersection point of segments p-q and r-s, or null. (Same math as route-widget.js segX.)
export function segIntersect(p, q, r, s) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (!d) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { point: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])], t, u };
}

// All crossings between two polylines: [{ point, segA, segB, along }] where along = distance along line A.
export function lineCrossings(a, b) {
  const out = [];
  let walked = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const segLen = dist(a[i], a[i + 1]);
    for (let j = 0; j < b.length - 1; j++) {
      const hit = segIntersect(a[i], a[i + 1], b[j], b[j + 1]);
      if (hit) out.push({ point: hit.point, segA: i, segB: j, along: walked + hit.t * segLen });
    }
    walked += segLen;
  }
  return out.sort((x, y) => x.along - y.along);
}

export function pointInPolygon([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Shortest distance from point to segment a-b.
export function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

// Point at a distance along a polyline.
export function pointAlong(pts, d) {
  for (let i = 0; i < pts.length - 1; i++) {
    const L = dist(pts[i], pts[i + 1]);
    if (d <= L) { const t = L ? d / L : 0; return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]; }
    d -= L;
  }
  return pts.at(-1);
}

export const toPath = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
