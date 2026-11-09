# Self-Contained Portfolio: Embedded Demo Plan

Audit of `cwramey.github.io` as of commit `c6817c8` (local `main` = `origin/main`), plus an architecture and
per-project blueprint for in-browser demos that need no backend, no third-party hosting and no external requests.

---

## 1. Audit

### 1.1 Project inventory (what the site actually shows)

The prompt that started this plan named Synapse, Katapult Export Tool, Atlas, Sentinel, Schema and Flux. **None of
those appear on the site.** The real lineup is:

| # | Project | Tier | Page | Maps to prompt name |
|---|---|---|---|---|
| 1 | Fiber Route Conflict Analyzer | Flagship | `fiber-route-analyzer.html` | — |
| 2 | Canvas: Network Design Surface (incl. Splice Case Designer, QC, BOM) | Flagship | `canvas-network-design.html` | Canvas / Splicing |
| 3 | Node: Field Crew Tracking | Flagship | `node-crew-tracking.html` | Field Crew Tracking |
| 4 | ArcPy Reporting & QA Suite | Also built | `arcpy-reporting-qa.html` | — |
| 5 | Design PDF Analyzer | Also built | `design-pdf-analyzer.html` | — |
| 6 | ArcGIS GDB Schema Tool | Also built | `arcgis-gdb-schema-tool.html` | Schema |

Plus one interactive piece that already exists: the **`shortest_route.py` widget** on the home page
(`route-widget.js`): seeded synthetic network, Dijkstra run step by step in SVG, code lines highlighted as it runs.
That widget is the proof that the approach below works on this stack, and its patterns (seeded PRNG, IIFE, SVG,
`aria-live` hints, `prefers-reduced-motion`) should be reused.

### 1.2 Current presentation

| Project | Showcase today |
|---|---|
| Fiber Route Analyzer | Case study: hero screenshot, metrics strip, ASCII architecture, 3 screenshots (open raw PNG in a new tab), writeup post |
| Canvas | Case study + screenshots; card says "Internal application · screenshots only" |
| Node | Case study + screenshots (demo data); "Internal application · screenshots only" |
| ArcPy Suite | Short detail page + writeup |
| Design PDF Analyzer | Short detail page + writeup |
| GDB Schema Tool | Short detail page + writeup |

### 1.3 Friction and bounce risk

The "external link" problem from the brief is **already solved**: commit `3c3b627 Remove project demo links` took out
the Render/Netlify/Streamlit links, and a grep finds no outbound demo or GitHub links. The friction that remains:

1. **Nothing to do on 6 of 7 project surfaces.** Every project is read-only. The one interactive element (route
   widget) is on the home page, not attached to any project. A recruiter's proof is "trust the metrics".
2. **Screenshots open raw PNGs in a new tab** (`target="_blank"` on `.shot` links). That's a mini exit: new tab, no
   nav, no way back except closing it.
3. **Internal tools can never be linked.** Canvas and Node are employer-internal, so a simulation on synthetic data is
   the *only* way they can ever be "tried". This is the biggest upside.
4. **One remaining external request:** `styles.css:1` `@import`s Google Fonts. It's render-blocking (an `@import`
   inside a stylesheet chains two round trips) and breaks the "zero external requests" goal.
5. **Dead / stale code worth clearing first:**
   - `script.js` lightbox: `openLightbox` is not called from any page. `SCREENSHOTS.project4` points at
     `gdb_schema1–5.png`, which don't exist.
   - `todo.md` still lists the Netlify pre-warm URL and the Streamlit "hibernate" problem; both are gone.
   - `README.md` lists `mockup.html`, which doesn't exist.
   - `assets/screenshots/*/manifest.json` are flagged legacy in the README.

---

## 2. Architecture: 100% client-side demo sandbox

### 2.1 Principles

- **No build step, no framework.** Matches the site. Native ES modules (`<script type="module">`), which GitHub
  Pages serves fine.
- **Every engine is a pure function over a small, seeded, synthetic dataset.** Same input → same output on every
  load, so the demo never flakes in front of a recruiter.
- **Honest framing.** Each demo is labelled *"Runs in your browser on sample data. Same logic as the production
  tool, not its data."* Canvas and Node data must be fictional (the Node screenshots already follow this rule).
- **Real outputs.** Where the real tool exports a file, the demo generates one with `Blob` +
  `URL.createObjectURL`: GeoJSON, CSV, KML, Markdown, `.py`. Visitors can open what they download.

### 2.2 File layout

```text
demos/
  sandbox.js          shared shell: lazy mount, tab toggle, reset, download helper, toasts
  sandbox.css         shared demo chrome (uses tokens from styles.css / redesign.css)
  lib/
    geom.js           segment intersection, buffer, length, point-in-polygon (lift segX from route-widget.js)
    rng.js            seeded PRNG (the mulberry32 already in route-widget.js)
    download.js       toCSV, toGeoJSON, toKML, saveText(name, mime, text)
    highlight.js      ~40-line tokenizer for Python/JSON syntax colouring (no Prism)
  fiber-route/  engine.js  view.js  data.json
  canvas/       engine.js  view.js  data.json
  node/         engine.js  view.js  data.json
  arcpy-qa/     engine.js  view.js  data.json
  pdf-analyzer/ engine.js  view.js  sheets.json  sheet-a.svg  sheet-b.svg
  gdb-schema/   engine.js  view.js  presets.json
fonts/            self-hosted woff2 (Hanken Grotesk, Inter, JetBrains Mono)
```

Split `engine.js` (pure, no DOM, unit-testable with `node --test`) from `view.js` (DOM/SVG). This is also a good
code-quality signal for anyone who opens the repo.

### 2.3 Mock data rules

- Synthetic, in a **local projected space in feet** (x/y 0–5,000), not lat/lon. No basemap tiles are needed and
  lengths come out right without pyproj. A grey street grid in SVG reads as "map" at a glance.
- Budget per demo: **≤ 30 KB JSON** and **≤ 25 KB JS** before gzip. Whole demo layer stays under ~250 KB and none of
  it loads until a visitor asks.
- Generate the data with a small committed script (`tools/make-demo-data.py`, GeoPandas is fine since it runs
  offline) so it can be regenerated and reviewed. Commit the JSON output.

### 2.4 Zero-dependency asset pipeline

1. Self-host the three fonts (woff2 subsets, Latin only, `font-display: swap`), replace the `@import` with
   `@font-face` rules, and `<link rel="preload">` the body font.
2. All demo icons are inline SVG or CSS. No icon fonts, no CDN.
3. Add a guard to CI or a pre-commit hook that fails on any external URL in `demos/`, `*.css`, or a
   `src=`/`@import`:

   ```bash
   ! grep -rnE "(src|href)=\"https?://|@import url\('https?://|fetch\(['\"]https?://" demos *.css *.html \
     | grep -v 'rel="canonical"\|og:\|cwramey.github.io'
   ```

4. Optional: a `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'">`
   on case-study pages. That *proves* zero external requests, since the browser blocks any it finds.

---

## 3. Project-by-project blueprints

Every demo has the same shape: **Step chips → controls → engine → visible output → downloadable artifact.**

### 3.1 Fiber Route Conflict Analyzer (flagship, build first)

- **Click:**
  1. Pick a route: `Route A · Downtown`, `Route B · River corridor`, `Route C · Rail yard`, or **Draw your own**
     (click vertices on the map, double-click to finish).
  2. Toggle reference layers: Roads, DOT roads, Rail, Water, Bridges, Pipelines, Parcels.
  3. **Run analysis**.
- **Engine** (`fiber-route/engine.js`):
  - For each route segment × layer feature: segment intersection (reuse `segX`), or point-in-polygon for parcels.
  - Classify each crossing: water/bridge/pipeline/rail → **High**, DOT road → **Medium**, city/county road →
    **Low**. Owner and jurisdiction come from the feature's attributes.
  - Merge consecutive crossings with the same jurisdiction into **permit corridors**, using the same model as
    production.
  - **Confidence** = 1.0 minus penalties for stale source (`lastEdit` > 365 days), a missing owner attribute, or a
    crossing near a layer boundary. One synthetic layer is deliberately stale so the Data Quality warning appears.
- **Output:**
  - Crossings appear as coloured markers. Permit corridors are drawn as a thick translucent buffer along the route.
  - A summary strip: length (ft / mi), crossings by risk, permits required.
  - A permit corridor table; clicking a row highlights it on the map.
  - A **Data Quality** callout: "Pipelines layer last edited 14 months ago, so confidence is reduced on 2 corridors."
  - **Downloads:** `route-conflicts.geojson`, `permit-corridors.csv`, `permit-summary.md`, and a KML for Google
    Earth. These mirror the real exporters.

### 3.2 Canvas: Splice, Trace, BOM and QC

One compact job: a CO cabinet → 144-ct feeder → splice closure SC-01 → two 12-ct distribution cables → 4 drops.

- **Click:**
  1. **Splice tray:** click a fiber on the left cable (TIA-598 colours: Blue, Orange, Green…), then a fiber on the
     right. An **Auto-splice 1:1** button fills the rest.
  2. **Trace:** click any drop. The path lights up end to end.
  3. **Generate BOM**, then **Run QC**.
- **Engine:**
  - Fiber graph: `{cable, tube, fiber}` nodes, with splices as edges. A trace is a graph walk. If the walk ends at
    an unspliced fiber, the trace stops there and says so.
  - BOM: aggregate drawn geometry and placed equipment × `costRates` from `data.json`, giving footage per cable type,
    closures, splices, and labour.
  - QC: 5 rule functions (`unsplicedFiber`, `dropTooLong > 250 ft`, `missingAttribute`, `doubleSplice`,
    `fiberCountMismatch`), each returning `{severity, featureId, message, suggestedFix}`.
- **Output:**
  - A splice table (live), plus an animated trace line with the hop list
    ("CO P1-F3 → SC-01 tray 1 → DIST-A F3 → Drop 2").
  - A BOM table with totals.
  - A QC findings list. **An open Blocker disables Submit**, exactly as the case study describes. Fixing the
    splice clears it and enables Submit.
  - **Downloads:** `splice-report.csv`, `bom.csv`.

### 3.3 Node: Live Dispatch Simulation

- **Click:** a **▶ Play day** button with a time scrubber (simulated 6:00–19:00 at ~120×), a **Region** filter, and a
  click on a crew card to open its day timeline. **Message crew** → canned message → simulated acknowledgement 3 s
  later. **Export today**.
- **Engine:**
  - Seeded event stream: 3 fictional contractors × 4 crews, each with a shift and a path of activity points.
  - `statusFor(crew, now)` is a pure function using the documented rules: **Working** (last report < 30 min),
    **Quiet** (30–90), **Not heard from** (> 90 during shift), **Done for the day**, **Not started**.
  - Recompute every simulated 30 s, matching the production 30 s status engine.
  - One crew has a late "offline sync" that back-fills events, which shows the "what counts as today" problem.
- **Output:**
  - Crew dots move on the SVG map, and status chips change colour.
  - Per-contractor stats tick up (installs, footage).
  - An hour-of-day histogram fills in as time plays.
  - A toast appears for the message ack.
  - **Download:** `crew-day.csv`.

### 3.4 ArcPy Reporting & QA Suite

ArcPy can't run in a browser, so simulate the *orchestration* and run the *QA rules* for real in JS.

- **Click:** pick a config profile (`county_permits.yaml`, `osp_monthly.yaml`). It shows in an editable code panel.
  Toggle checks (Null fields, Duplicate IDs, Length mismatch, Orphan features). Click **Run suite**.
- **Engine:** parse the config (tiny YAML subset, or use JSON shown as YAML), run each enabled rule over a 60-row
  feature table in `data.json`, and stream log lines with realistic timings via `setTimeout`.
- **Output:**
  - A terminal-style log (`[12:04:31] qa.duplicate_ids … 3 found`).
  - A QA results table that links rows to features.
  - A generated **map-export layout** (SVG page: title block, legend, scale bar, north arrow) as a thumbnail.
  - **Downloads:** `qa-report.csv`, `qa-report.html`.

### 3.5 Design PDF Analyzer

- **Click:** pick a sample sheet (`Sheet A · Aerial`, `Sheet B · Underground`), then **Extract**.
  Optional: **Show regex** toggle.
- **Engine:**
  - The sheets are **synthetic SVGs with real `<text>` elements**, standing in for a PDF text layer. Bundling pdf.js
    (~1 MB) isn't worth it.
  - Run the same kinds of patterns as production: station chains `STA\s*(\d+)\+(\d{2})` → feet, footage labels
    `(\d{1,5})'\s*(AERIAL|UG|FIBER)`, poles `\bP-?\d{3,5}\b`, ducts `(\d)\s*[-x]\s*(\d(?:\.\d+)?)"\s*DUCT`.
  - Total per sheet and cross-check the station-chain length against the sum of labels. A deliberate 50 ft mismatch
    shows the validation.
- **Output:**
  - Matched labels get highlight boxes on the sheet, colour-coded by type.
  - The extraction table, totals, and a mismatch warning.
  - A JSON panel.
  - Elapsed time ("parsed in 4 ms").
  - **Download:** `sheet-a-extract.json` / `.csv`.

### 3.6 ArcGIS GDB Schema Tool

- **Click:** load the preset `Fiber_OSP` schema (feature classes, domains, one relationship class). Use
  **+ Field** (name, type), **Assign domain**, **Validate**, and **Generate ArcPy**.
- **Engine:**
  - Schema JSON model plus validators. Names must start with a letter and use `[A-Za-z0-9_]`, with a length limit.
    Reserved words are rejected. A domain's type must match its field's type. Relationship keys must exist and
    share a type.
  - A generator emits `arcpy.management.CreateDomain` / `AddCodedValueToDomain` / `CreateFeatureclass` / `AddField` /
    `AssignDomainToField` / `CreateRelationshipClass`.
- **Output:**
  - A node graph of feature classes in SVG, with relationship lines.
  - Inline validation errors next to fields.
  - Syntax-highlighted `.py` with **Copy** and **Download** (`build_fiber_osp.py`, `schema.json`).
  - Typing an invalid name such as `1st_Name` shows an error instantly, which is a good 2-second "it's real" moment.

---

## 4. UI/UX integration

### 4.1 Case study vs. live demo toggle

- **Case-study pages:** replace the hero `figure.case-shot` with a two-tab panel: **`Screenshot` | `▶ Live demo`**.
  - The screenshot tab is the default render, so there's no layout shift and the page stays fast.
  - Clicking **Live demo** swaps it for the sandbox, inside the same frame and at the same aspect ratio.
  - `#demo` in the URL opens straight to the demo tab, so links are shareable.
- **Portfolio cards:** add a primary **`▶ Try it live`** button that links to `case-page.html#demo`. Keep "Read the
  case study" as the secondary link.
- **No modals.** An inline panel is more reliable on phones, keeps scroll position, and is linkable.
- **Also-built pages** are thin today. Put the demo directly under the overview as the page's centrepiece.
- **Fix the screenshot grid** while you're there: open shots in an in-page lightbox (rewire the dead
  `openLightbox`) instead of `target="_blank"`.

### 4.2 Performance and mobile safeguards

- **Zero demo bytes on page load.** `sandbox.js` (~3 KB) registers an `IntersectionObserver`. The engine and data
  are fetched via dynamic `import()` only when the tab is clicked or `#demo` is present. On fast connections they can
  prefetch on `pointerenter` of the button.
- **Reserve space:** `aspect-ratio: 16/10` on the frame means no CLS when the demo mounts.
- **Unmount when far off-screen** (Node's play loop) and pause on `visibilitychange`.
- **`prefers-reduced-motion`:** skip animation, jump to the final state. route-widget already does this.
- **Mobile (< 640 px):** controls stack above the viewport. Tables collapse into stacked key/value cards. Use
  ≥ 44 px tap targets. For "draw your own route", use tap-to-add-vertex plus a **Done** button, because double-click
  doesn't exist on touch. SVG `viewBox` scales for free.
- **Accessibility:** demos are keyboard-operable (route-widget's `tabindex` + Enter/Space pattern), and results are
  announced via `aria-live="polite"`.

### 4.3 Micro-copy so it's obvious in 2 seconds

| Spot | Copy |
|---|---|
| Tab label | `▶ Live demo` |
| Under the tab | `Runs in your browser · sample data · no sign-up` |
| Step chips (Fiber Route) | `1 Pick a route` → `2 Run analysis` → `3 Download the permit report` |
| Step chips (Canvas) | `1 Click a fiber on each cable` → `2 Trace a drop` → `3 Run QC` |
| Empty output panel | `Results appear here. Try Route B. It crosses a river and a rail line.` |
| After first run | `✓ 7 crossings, 3 permits. Click a row to find it on the map.` |
| Footer of every demo | `Same rules as the production tool. Synthetic data, no client information.` |

Make the first primary button pulse once, and only once.

---

## 5. Deliverables

### 5.1 Project interactive demo matrix

| Project | Current showcase | Proposed embedded demo | Simulated clicks | Instant visible output |
|---|---|---|---|---|
| Fiber Route Conflict Analyzer | Case study + 4 screenshots + writeup | SVG mini-map conflict engine | Pick/draw route · toggle layers · **Run analysis** | Risk-coloured crossings, corridor buffers, permit table, data-quality warning, GeoJSON/CSV/MD/KML downloads |
| Canvas | Case study + screenshots ("internal") | Splice tray + trace + BOM + QC | Splice fibers · trace a drop · **Generate BOM** · **Run QC** | Splice table, animated trace with hop list, BOM totals, QC list; Blocker disables Submit |
| Node | Case study + screenshots ("internal") | Simulated dispatch day | **▶ Play day** · region filter · open crew · message crew | Moving crews, live status chips, contractor stats, hour histogram, ack toast, CSV |
| ArcPy Reporting & QA | Detail page + writeup | Config-driven QA run console | Pick profile · toggle checks · **Run suite** | Streaming log, QA table, generated map-layout SVG, CSV/HTML report |
| Design PDF Analyzer | Detail page + writeup | Regex extraction over SVG text layer | Pick sheet · **Extract** · show regex | Highlighted labels on sheet, footage/pole/duct table, mismatch warning, JSON |
| GDB Schema Tool | Detail page + writeup | Schema graph editor + ArcPy codegen | Load preset · add field · assign domain · **Generate ArcPy** | Graph, live validation errors, highlighted `.py` + `schema.json` download |
| `shortest_route.py` (home) | Already interactive | Keep. Port onto `sandbox.js` later for consistency | — | — |

### 5.2 Code scaffold: reusable sandbox

**HTML** (in a case-study page, replacing the hero `figure.case-shot`):

```html
<section class="wrap" style="padding-bottom:72px">
  <div class="demo" data-demo="pdf-analyzer" data-ratio="16/10">
    <div class="demo-tabs" role="tablist" aria-label="Presentation">
      <button role="tab" aria-selected="true"  data-tab="shot">Screenshot</button>
      <button role="tab" aria-selected="false" data-tab="live">▶ Live demo</button>
      <span class="demo-note">Runs in your browser · sample data · no sign-up</span>
    </div>
    <div class="demo-frame">
      <figure class="demo-pane case-shot" data-pane="shot">
        <img src="assets/screenshots/project3/pdf_tool1.png" alt="Design PDF Analyzer extraction view">
      </figure>
      <div class="demo-pane" data-pane="live" hidden></div>
    </div>
  </div>
</section>
<script type="module" src="demos/sandbox.js"></script>
```

**`demos/sandbox.js`**: shell, lazy mount, tabs, deep link, download helper.

```js
// Shared demo shell. Each demo module exports mount(el, ctx) and may return an unmount().
const MODULES = {
  'pdf-analyzer': () => import('./pdf-analyzer/view.js'),
  'fiber-route':  () => import('./fiber-route/view.js'),
  // ...one line per demo
};

export function saveText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ctx = {
  saveText,
  reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  announce(el, msg) { el.textContent = msg; },               // target an aria-live node
};

function setup(root) {
  const key = root.dataset.demo;
  const live = root.querySelector('[data-pane="live"]');
  const tabs = root.querySelectorAll('[role="tab"]');
  let mounted = null, loading = null;

  const load = () => (loading ??= MODULES[key]());          // also used for hover-prefetch

  async function show(tab) {
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    root.querySelectorAll('[data-pane]').forEach(p => (p.hidden = p.dataset.pane !== tab));
    if (tab !== 'live' || mounted) return;
    live.innerHTML = '<p class="demo-loading">Loading demo…</p>';
    try {
      const mod = await load();
      live.innerHTML = '';
      mounted = (await mod.mount(live, ctx)) || (() => {});
    } catch (err) {
      live.innerHTML = '<p class="demo-loading">The demo could not load. The screenshot tab still works.</p>';
      console.error(err);
    }
  }

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
  root.querySelector('[data-tab="live"]').addEventListener('pointerenter', load, { once: true });
  if (location.hash === '#demo') { show('live'); root.scrollIntoView({ block: 'start' }); }
}

document.querySelectorAll('.demo[data-demo]').forEach(setup);
```

**`demos/pdf-analyzer/engine.js`**: a pure engine, no DOM, testable with `node --test`.

```js
export const PATTERNS = {
  station: /STA\s*(\d+)\+(\d{2})/g,                       // STA 12+50 -> 1250 ft
  footage: /(\d{1,5})'\s*(AERIAL|UG|FIBER)/g,
  pole:    /\bP-?(\d{3,5})\b/g,
  duct:    /(\d)\s*[-x]\s*(\d(?:\.\d+)?)"\s*DUCT/g,
};

// labels: [{ id, text }] taken from the sheet SVG's <text> nodes
export function extract(labels) {
  const hits = [];
  for (const { id, text } of labels) {
    for (const [kind, re] of Object.entries(PATTERNS)) {
      for (const m of text.matchAll(re)) hits.push({ id, kind, match: m[0], groups: m.slice(1) });
    }
  }
  const stations = hits.filter(h => h.kind === 'station')
    .map(h => +h.groups[0] * 100 + +h.groups[1]).sort((a, b) => a - b);
  const chainFt = stations.length > 1 ? stations.at(-1) - stations[0] : 0;
  const footage = hits.filter(h => h.kind === 'footage')
    .reduce((acc, h) => ((acc[h.groups[1]] = (acc[h.groups[1]] || 0) + +h.groups[0]), acc), {});
  const labelledFt = Object.values(footage).reduce((a, b) => a + b, 0);
  return {
    hits,
    totals: {
      footage, labelledFt, chainFt,
      poles: new Set(hits.filter(h => h.kind === 'pole').map(h => h.groups[0])).size,
      ducts: hits.filter(h => h.kind === 'duct').length,
    },
    warnings: chainFt && Math.abs(chainFt - labelledFt) > 25
      ? [`Station chain is ${chainFt} ft but labels sum to ${labelledFt} ft (Δ ${chainFt - labelledFt} ft).`] : [],
  };
}
```

**`demos/pdf-analyzer/view.js`**: wires the engine to the DOM.

```js
import { extract } from './engine.js';

export async function mount(el, { saveText, announce }) {
  el.innerHTML = `
    <div class="demo-ctl">
      <ol class="demo-steps"><li>Pick a sheet</li><li>Extract</li><li>Download</li></ol>
      <select id="pdf-sheet"><option value="sheet-a">Sheet A · Aerial</option><option value="sheet-b">Sheet B · Underground</option></select>
      <button class="button-primary demo-pulse" id="pdf-run">Extract</button>
      <button class="button-secondary" id="pdf-dl" disabled>Download JSON</button>
    </div>
    <div class="demo-split">
      <div class="demo-view" id="pdf-view"></div>
      <div class="demo-out"><p id="pdf-status" aria-live="polite">Results appear here.</p><table id="pdf-table"></table></div>
    </div>`;
  const $ = s => el.querySelector(s);
  let last;

  async function loadSheet() {
    const svg = await (await fetch(new URL(`./${$('#pdf-sheet').value}.svg`, import.meta.url))).text();
    $('#pdf-view').innerHTML = svg;            // same-origin, committed file, so innerHTML is safe here
    $('#pdf-table').innerHTML = ''; $('#pdf-dl').disabled = true;
  }

  $('#pdf-sheet').addEventListener('change', loadSheet);
  $('#pdf-run').addEventListener('click', () => {
    $('#pdf-run').classList.remove('demo-pulse');
    const t0 = performance.now();
    const labels = [...$('#pdf-view').querySelectorAll('text')].map((n, i) => (n.dataset.i = i, { id: i, text: n.textContent }));
    last = extract(labels);
    last.hits.forEach(h => $(`#pdf-view text[data-i="${h.id}"]`)?.classList.add('hit', `hit-${h.kind}`));
    const t = last.totals;
    $('#pdf-table').innerHTML = `
      <tr><th>Labelled footage</th><td>${t.labelledFt.toLocaleString()} ft</td></tr>
      <tr><th>Station chain</th><td>${t.chainFt.toLocaleString()} ft</td></tr>
      <tr><th>Poles</th><td>${t.poles}</td></tr><tr><th>Ducts</th><td>${t.ducts}</td></tr>`;
    announce($('#pdf-status'), `✓ ${last.hits.length} labels parsed in ${(performance.now() - t0).toFixed(1)} ms. ${last.warnings.join(' ')}`);
    $('#pdf-dl').disabled = false;
  });
  $('#pdf-dl').addEventListener('click', () =>
    saveText(`${$('#pdf-sheet').value}-extract.json`, JSON.stringify(last, null, 2), 'application/json'));

  await loadSheet();
}
```

**`demos/sandbox.css`**: the shared chrome, built on existing tokens.

```css
.demo-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.demo-tabs [role=tab]{font:600 13px/1 var(--mono);padding:10px 14px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;cursor:pointer;min-height:44px}
.demo-tabs [aria-selected=true]{background:var(--accent);color:#04111f;border-color:var(--accent)}
.demo-note{font:12px var(--mono);color:#7f8ea3}
.demo-frame{aspect-ratio:16/10;border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden}
.demo-frame .case-shot img{border:0;border-radius:0}
.demo-pane[data-pane=live]{height:100%;display:flex;flex-direction:column;overflow:auto}
.demo-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;border-bottom:1px solid var(--line)}
.demo-steps{display:flex;gap:6px;list-style:none;margin:0 auto 0 0;padding:0;counter-reset:s;font:12px var(--mono)}
.demo-steps li::before{counter-increment:s;content:counter(s) " ";color:var(--accent)}
.demo-split{display:grid;grid-template-columns:3fr 2fr;flex:1;min-height:0}
.demo-view,.demo-out{overflow:auto;padding:12px}
.demo-loading{margin:auto;color:#7f8ea3;font:13px var(--mono)}
.hit{paint-order:stroke;stroke-width:6px}
.hit-footage{stroke:#38bdf866}.hit-pole{stroke:#f59e0b66}.hit-station{stroke:#a78bfa66}.hit-duct{stroke:#34d39966}
@keyframes demo-pulse{0%{box-shadow:0 0 0 0 #38bdf888}100%{box-shadow:0 0 0 12px #38bdf800}}
.demo-pulse{animation:demo-pulse 1.4s ease-out 2}
@media (max-width:640px){.demo-frame{aspect-ratio:auto}.demo-split{grid-template-columns:1fr}.demo-view{max-height:60vh}}
@media (prefers-reduced-motion:reduce){.demo-pulse{animation:none}}
```

### 5.3 Prioritized update checklist

**P0: foundation (½ day)**
- [ ] Self-host fonts and remove the Google Fonts `@import`. This makes the site truly zero-external and removes a render-blocking chain.
- [ ] Remove dead code and stale docs: unused lightbox + `SCREENSHOTS.project4`, the pre-warm/Streamlit items in `todo.md`, `mockup.html` in the README, legacy `manifest.json` files.
- [ ] Add `demos/sandbox.js`, `sandbox.css`, `lib/` (lift `segX` and the PRNG out of `route-widget.js`).
- [ ] Add the external-URL guard (grep in a pre-commit hook or a GitHub Action).

**P1: flagship demos (highest recruiter value)**
- [ ] Fiber Route Conflict Analyzer demo: preset routes, run, corridor table, GeoJSON/CSV/MD downloads.
- [ ] Canvas demo: splice tray, trace, QC Blocker gating Submit, BOM. This is the only way to "use" an internal tool.
- [ ] Node demo: play-day simulation with the status engine.
- [ ] Add `▶ Try it live` buttons on `portfolio.html` and home cards, deep-linking to `#demo`.

**P2: also-built demos**
- [ ] Design PDF Analyzer (smallest; good warm-up and already scaffolded above).
- [ ] GDB Schema Tool (validation + ArcPy codegen).
- [ ] ArcPy QA Suite (config → QA run → log + report).

**P3: polish and proof**
- [ ] `node --test` suites for every `engine.js`, run in a GitHub Action. Add a "Tested" badge on demo footers.
- [ ] Mobile QA pass at 375 px for every demo, keyboard-only pass, `prefers-reduced-motion` pass.
- [ ] Lighthouse budget: Performance ≥ 95 on case-study pages with the demo tab closed, and CLS 0 when opened.
- [ ] Rewire screenshot grids to an in-page lightbox instead of `target="_blank"`.
- [ ] Optional CSP meta on case-study pages.
- [ ] Optional: privacy-friendly, self-hosted click counting is not possible without a third party. If you add
      GoatCounter later, accept that one external request on purpose, and track `demo_open` / `demo_run` events.
