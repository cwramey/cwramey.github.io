// Client-side file generation. No network: files are built in memory and saved via a Blob URL.

export function saveText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// rows: array of plain objects. columns: optional ordered list of keys.
export function toCSV(rows, columns = Object.keys(rows[0] ?? {})) {
  return [columns.map(cell).join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n');
}

// features: [{ geometry: {type, coordinates}, properties }]
export function toGeoJSON(features) {
  return JSON.stringify({ type: 'FeatureCollection', features: features.map(f => ({ type: 'Feature', ...f })) }, null, 2);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// placemarks: [{ name, description, coordinates: [[lon, lat], ...] | [lon, lat] }]
export function toKML(name, placemarks) {
  const geom = c => Array.isArray(c[0])
    ? `<LineString><coordinates>${c.map(p => p.join(',')).join(' ')}</coordinates></LineString>`
    : `<Point><coordinates>${c.join(',')}</coordinates></Point>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>
${placemarks.map(p => `<Placemark><name>${esc(p.name)}</name><description>${esc(p.description ?? '')}</description>${geom(p.coordinates)}</Placemark>`).join('\n')}
</Document></kml>`;
}
