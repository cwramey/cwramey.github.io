# cwramey.github.io

Personal portfolio — Charles Ramey, GIS Developer & Spatial Data Engineer.

Built with plain HTML, CSS, and minimal JavaScript. Hosted on GitHub Pages.

## Structure

```text
index.html              — single-page portfolio
styles.css              — all styles
script.js               — smooth scroll, nav highlighting, screenshot gallery, lightbox
assets/
  resume.pdf            — downloadable resume
  screenshots/
    project1/           — Fiber Route Analyzer screenshots
      manifest.json     — ordered list of screenshots and captions
      fiber_route1.png
      ...
    project2/           — project 2 screenshots
      manifest.json
    project3/           — project 3 screenshots
      manifest.json
```

## Adding Screenshots

Drop image files into the relevant `assets/screenshots/projectN/` folder, then add an entry to that folder's `manifest.json`:

```json
[
  { "file": "my-screenshot.png", "caption": "Description shown in lightbox" }
]
```

Screenshots are sorted automatically by the trailing number in the filename (e.g. `fiber_route3.png` always appears third). Order in the manifest file does not matter.

## Adding a New Project

1. Add a new `project-card` div in `index.html` following the existing pattern
2. Set `data-project="project4"` (or the next number) on the `.screenshots-gallery` div
3. Create `assets/screenshots/project4/manifest.json` with an empty array `[]`
