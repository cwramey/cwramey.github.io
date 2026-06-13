# Portfolio To-Do

Tracking remaining setup and improvements for <https://cwramey.github.io/>.
Items are grouped by priority. Check them off as they're done.

---

## 🔴 Priority — credibility gaps

### Finish the résumé
`resume.html` still has placeholder content flagged with amber `[edit]` / `[soon]` badges.

- [ ] Replace the 3 placeholder **Experience** entries (`20XX` dates, "Company / Organization", titles, bullets) with real work history.
- [ ] Replace the placeholder **Education** entry with real degree(s).
- [ ] Remove the `<span class="resume-todo">` flags once filled in.
- _Hand the real history to Claude and it can populate this directly._

### Show the code (for employers)
- [ ] Add a **"View Code ↗"** link to each project (featured + 3 portfolio cards) pointing at the GitHub repos.
  - Need repo URLs for: Fiber Route Analyzer, ArcPy Reporting & QA Suite, Design PDF Analyzer.

### Availability
- [ ] Add an **availability / status line** (e.g. "Available for contract & freelance — GIS automation, spatial data pipelines") near the hero or contact section.

---

## 🟡 Google Search Console (indexing & search visibility)

The `sitemap.xml`, `robots.txt`, and JSON-LD are already in place. Remaining steps require your Google account:

- [ ] Go to <https://search.google.com/search-console> and **add property** `https://cwramey.github.io/` (URL-prefix property).
- [ ] **Verify ownership** using the **HTML tag** method. Google gives a tag like:
      `<meta name="google-site-verification" content="XXXXXXXXXXXX">`
      → paste it to Claude to add into each page's `<head>` (or add it yourself).
- [ ] After verifying, open **Sitemaps** in Search Console and submit `sitemap.xml`.
- [ ] (Optional) Do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters) — it can import directly from Google Search Console.
- [ ] Once indexed, check the **Performance** report periodically to see what queries surface your site.

> Note: none of this takes effect until the latest changes are **committed and pushed** to GitHub Pages.

---

## 🟢 Conversion — turn visitors into contacts

- [ ] **Mini case studies** — expand the featured project from a blurb into Problem → Approach → Result.
- [ ] **Demo GIF or 30-sec video** per project (the Streamlit demos hibernate on the free tier; a GIF makes the value land instantly even when the live app is cold).
- [ ] **Headshot + a human sentence** on the About page.
- [ ] **Testimonial / LinkedIn recommendation** — even one quote is strong social proof.

---

## 🔵 Visibility — get found by people not already searching for you

- [ ] **Custom domain** (e.g. `charlesramey.dev` / `rameygis.com`). Buy the domain (~$12/yr), add a `CNAME` file, and configure DNS. More memorable and more professional than `*.github.io`.
- [x] **Blog posts** — all three core posts published:
  - [x] Detecting Fiber Route Conflicts with GeoPandas
  - [x] Building a Reusable ArcPy Reporting Pipeline
  - [x] Pulling Footage & Pole Counts from Telecom Design PDFs
  - [ ] Keep writing — each new post = its own indexable URL + authority. Highest long-term ROI.
- [ ] **Off-site distribution** (no code changes):
  - [ ] Pin the 3 project repos on your GitHub profile.
  - [ ] Add a GitHub **profile README** linking to the site.
  - [ ] Add the site URL to LinkedIn, your email signature, and your Esri Community profile.
  - [ ] Share posts in relevant communities (r/gis, GIS Stack Exchange, Esri Community).

---

## ⚙️ Technical / measurement

- [ ] **Privacy-friendly analytics** — [Plausible](https://plausible.io) (paid, polished) or [GoatCounter](https://www.goatcounter.com) (free). Lightweight, no cookie banner needed. _Can't improve what you don't measure._
- [ ] **Mobile QA pass** — check hero, featured card, portfolio grid, résumé timeline, and blog on a phone width.
- [ ] **Delete `mockup.html`** — dev artifact, not linked from the site.
- [ ] Confirm the demo **pre-warm URL** in `script.js` matches where the Fiber Route app actually lives (currently `fiber-route-analyzer.netlify.app`).

---

## ✅ Done

- Centered, terminal-themed layout across home / about / résumé / blog
- Featured project + 3-card portfolio with working screenshot lightbox
- Résumé page with timeline + Print/Save-as-PDF
- Blog index + first published post (Detecting Fiber Route Conflicts with GeoPandas)
- `sitemap.xml`, `robots.txt`
- JSON-LD `Person` (home) and `BlogPosting` (post) structured data
- Open Graph / Twitter cards, canonical URLs, favicon, per-page meta descriptions
