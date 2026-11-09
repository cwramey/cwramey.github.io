# Embedded demos

Every project demo runs entirely in the browser on committed, synthetic sample data. No backend, no CDN, no
external requests. See `docs/self-contained-demos-plan.md` for the design.

## Shared pieces (do not edit from a single demo's work)

| File | Purpose |
|---|---|
| `sandbox.js` | Tab toggle, lazy mount, `#demo` deep link, `ctx` helpers |
| `sandbox.css` | Shared chrome: `.demo-btn`, `.demo-ctl`, `.demo-steps`, `.demo-split`, `.demo-view`, `.demo-out`, `.demo-stats`, `.demo-table`, `.demo-badge--high/med/low/blocker/major/minor/info`, `.demo-callout`, `.demo-code` + `.tk-*`, `.demo-dl`, `.demo-foot`, `.demo-toast`, `.demo-pulse` |
| `lib/geom.js` | `dist`, `lineLength`, `segIntersect`, `lineCrossings`, `pointInPolygon`, `pointSegDist`, `pointAlong`, `toPath` |
| `lib/rng.js` | `rng(seed)` → `r()`, `r.range(a,b)`, `r.int(a,b)`, `r.pick(arr)` |
| `lib/download.js` | `saveText`, `toCSV`, `toGeoJSON`, `toKML` |
| `lib/highlight.js` | `highlight(code, 'python' | 'json' | 'yaml')` |

## Adding a demo `<key>`

Create `demos/<key>/` with:

- `engine.js`: pure logic, no DOM. Must run under `node --test` (`demos/<key>/engine.test.js`).
- `view.js`: `export async function mount(el, ctx)`. Builds the UI inside `el` (the live pane).
- `demo.css`: styles scoped under `.demo[data-demo="<key>"]`. Loaded automatically on first open.
- Data files (`data.json`, `*.svg`): load with `await ctx.json('data.json')` or `fetch(ctx.asset('x.svg'))`.

`ctx` gives you `root`, `saveText(name, text, mime)`, `toCSV(rows, cols)`, `reduceMotion`, `asset(path)`,
`json(path)`, `announce(el, msg)` (for `aria-live` nodes) and `toast(msg)`.

## Page markup

Add to the page `<head>`: `<link rel="stylesheet" href="demos/sandbox.css">`. Before `</body>`:
`<script type="module" src="demos/sandbox.js"></script>`. Where the demo should appear:

```html
<div class="demo" data-demo="<key>" id="demo">
  <div class="demo-frame"><div class="demo-pane" data-pane="live"></div></div>
</div>
```

The demo is always shown inline (no screenshot/live toggle). `sandbox.js` mounts it when it comes within
~400 px of the viewport, or immediately when the URL has `#demo`. Every demo ends with
`<p class="demo-foot">Same rules as the production tool. Synthetic data, no client information.</p>`.

Portfolio screenshots are captured from these demos with `node tools/capture-demos.mjs` (see that file).

## Rules

- No external URLs anywhere in `demos/`.
- Each demo stays within ~25 KB JS and ~30 KB data.
- Keyboard operable, `aria-live` status line, honours `ctx.reduceMotion`, usable at 375 px wide.
