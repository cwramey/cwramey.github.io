# cwramey.github.io

Personal portfolio — **Charles Ramey, GIS Developer & Spatial Data Engineer**.

Built with plain HTML, CSS, and minimal vanilla JavaScript. No build step, no framework. Hosted on GitHub Pages.

**Live:** <https://cwramey.github.io/>

## Design

Dark terminal / "hacker" aesthetic driven by CSS custom properties defined in `:root` (see top of `styles.css`):

- `--accent: #38bdf8` (sky blue) — primary accent
- `--bg-page / --bg-dark / --bg-darker` — layered dark backgrounds
- Monospace (`Courier New`) accents for eyebrows, badges, code, and footers
- Section headings use an enlarged `// SECTION` blue eyebrow (`.section-eyebrow--heading`) instead of plain white headings
- Hero, featured, portfolio, and contact sections are center-aligned

## Pages

```text
index.html        — single-page home: hero, featured project, 3-card portfolio grid, contact
about.html        — background, what I build / how I work, technical skill stack
resume.html       — terminal-styled timeline résumé + Print/Save-as-PDF (print stylesheet)
blog.html         — blog index (post cards)
posts/
  detecting-fiber-route-conflicts-with-geopandas.html   — first published post
mockup.html       — dev artifact / layout reference (not linked; safe to delete)
```

## Shared files

```text
styles.css        — all styles (single stylesheet, used by every page)
script.js         — screenshot lightbox, smooth scroll, active-nav highlighting, demo pre-warm
robots.txt        — allows all crawlers; points to the sitemap
sitemap.xml       — lists all public URLs for search engines
assets/
  screenshots/
    project1/     — Fiber Route Analyzer (fiber_route1–5.png)
    project2/     — ArcPy Reporting & QA Suite (gis_tool1–5.png)
    project3/     — Design PDF Analyzer (pdf_tool1–3.png)
```

> **Note:** the `manifest.json` files inside each screenshot folder are legacy and no longer read. The lightbox now uses the `SCREENSHOTS` map at the top of `script.js` (see below).

## SEO / discoverability

- **JSON-LD `Person`** schema in `index.html` `<head>` (feeds Google knowledge panel)
- **JSON-LD `BlogPosting`** schema in each post
- **Open Graph + Twitter card** meta tags for social sharing
- Per-page `<title>`, `meta description`, and `<link rel="canonical">`
- Inline SVG favicon (🗺️), `theme-color`
- `sitemap.xml` + `robots.txt`

See `todo.md` for the remaining Google Search Console setup and other planned improvements.

## How the screenshot lightbox works

Each project's screenshots are declared in the `SCREENSHOTS` map at the top of `script.js`:

```js
const SCREENSHOTS = {
  project1: ['fiber_route1.png', ... ],
  project2: ['gis_tool1.png', ... ],
  project3: ['pdf_tool1.png', ... ],
};
```

Clickable elements call `openLightbox('projectN')` via an inline `onclick` (the featured image pane and each portfolio card's "View N Screenshots" button). The lightbox supports prev/next, a `n / total` counter, arrow-key navigation, and Escape-to-close.

## Adding screenshots to an existing project

1. Drop the image into `assets/screenshots/projectN/`.
2. Add its filename to that project's array in the `SCREENSHOTS` map in `script.js`.
3. Update the visible count in the button text / badge in `index.html` (e.g. `View 6 Screenshots`).

Files are listed in the order they appear in the array.

## Adding a new project to the portfolio grid

1. Copy an existing `.portfolio-card` block in `index.html` and edit the category, title, description, and tags.
2. Point its screenshots button at the new project: `onclick="openLightbox('project4')"`.
3. Add a `project4` entry to the `SCREENSHOTS` map in `script.js` and create `assets/screenshots/project4/`.
4. Set the `Launch Demo`/code links.

## Adding a blog post

1. Copy `posts/detecting-fiber-route-conflicts-with-geopandas.html` to a new file in `posts/`.
2. Update the `<title>`, meta description, canonical URL, Open Graph tags, and the `BlogPosting` JSON-LD.
3. Write the article inside `.post-body` (use `<h2>`, `<p>`, `<pre><code>`, and `.post-callout` for styling).
4. Add a `.blog-post-card` link to `blog.html`.
5. Add the post URL to `sitemap.xml`.

## Local preview

```bash
python -m http.server 8000
# then open http://localhost:8000/
```

Use a local server (not `file://`) so relative paths, `fetch`, and JSON-LD behave exactly as on GitHub Pages.

## Deploy

Commit and push to the default branch. GitHub Pages serves the site automatically.
