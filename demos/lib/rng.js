// Seeded PRNG (mulberry32, as in route-widget.js) so demo data looks the same on every load.
export function rng(seed = 7) {
  let s = seed | 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => Math.floor(next.range(a, b + 1));
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  return next;
}
