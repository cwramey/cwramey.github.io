// Shared demo shell for every embedded project demo.
//
// Markup contract (see demos/README.md):
//   <div class="demo" data-demo="<key>" id="demo"><div class="demo-frame"><div class="demo-pane" data-pane="live"></div></div></div>
//   <script type="module" src="demos/sandbox.js"></script>   (path relative to the page)
//
// When the demo nears the viewport, the shell loads demos/<key>/demo.css and
// demos/<key>/view.js, then calls the module's mount(el, ctx). mount may return
// an unmount function. Nothing demo-specific loads before that.
import { saveText, toCSV } from './lib/download.js';

const base = new URL('./', import.meta.url);

function loadCSS(key) {
  const href = new URL(`${key}/demo.css`, base).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
  document.head.append(link);
}

// The demo is always shown inline. Its code and data load when it comes within
// ~400 px of the viewport (or immediately for a #demo deep link).
async function mountDemo(root) {
  const key = root.dataset.demo;
  const live = root.querySelector('[data-pane="live"]');
  live.innerHTML = '<p class="demo-loading">Loading demo…</p>';
  try {
    loadCSS(key);
    const mod = await import(new URL(`${key}/view.js`, base).href);
    live.innerHTML = '';
    await mod.mount(live, makeCtx(root));
    root.classList.add('demo--live');
  } catch (err) {
    live.innerHTML = '<p class="demo-loading">The demo could not load. Try reloading the page.</p>';
    console.error(err);
  }
}

function setup(root) {
  if (location.hash === '#demo' || !('IntersectionObserver' in window)) {
    mountDemo(root);
    if (location.hash === '#demo') requestAnimationFrame(() => root.scrollIntoView({ block: 'start' }));
    return;
  }
  const io = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect();
    mountDemo(root);
  }, { rootMargin: '400px 0px' });
  io.observe(root);
}

function makeCtx(root) {
  return {
    root,
    saveText,
    toCSV,
    reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    // Resolve a file inside the demo's own folder, e.g. ctx.asset('data.json')
    asset: path => new URL(`${root.dataset.demo}/${path}`, base).href,
    async json(path) { return (await fetch(this.asset(path))).json(); },
    announce(el, msg) { el.textContent = ''; requestAnimationFrame(() => (el.textContent = msg)); },
    toast(msg, ms = 2600) {
      const t = Object.assign(document.createElement('div'), { className: 'demo-toast', textContent: msg });
      t.setAttribute('role', 'status');
      root.append(t);
      setTimeout(() => t.remove(), ms);
    },
  };
}

document.querySelectorAll('.demo[data-demo]').forEach(setup);
