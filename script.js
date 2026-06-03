// Load screenshot manifests and populate galleries on page load
document.querySelectorAll('.screenshots-gallery[data-project]').forEach(gallery => {
  const project = gallery.dataset.project;
  const base = `assets/screenshots/${project}`;
  fetch(`${base}/manifest.json`)
    .then(r => r.ok ? r.json() : [])
    .then(items => {
      items.sort((a, b) => {
        const n = s => parseInt(s.file.match(/(\d+)(?=\.\w+$)/) || [0, 0], 10);
        return n(a) - n(b);
      });
      const grid = gallery.querySelector('.screenshot-grid');
      const pill = gallery.closest('.project-card').querySelector('.screenshots-pill');
      const countEl = pill.querySelector('.pill-count');
      countEl.textContent = items.length;
      if (items.length === 0) {
        pill.style.display = 'none';
        return;
      }
      items.forEach(item => {
        const src = `${base}/${item.file}`;
        const btn = document.createElement('button');
        btn.className = 'screenshot-thumb';
        btn.dataset.src = src;
        btn.dataset.caption = item.caption || '';
        btn.onclick = () => openLightbox(btn);
        const img = document.createElement('img');
        img.src = src;
        img.alt = item.caption || '';
        img.loading = 'lazy';
        btn.appendChild(img);
        grid.appendChild(btn);
      });
    })
    .catch(() => {
      const pill = gallery.closest('.project-card').querySelector('.screenshots-pill');
      if (pill) pill.style.display = 'none';
    });
});

// Screenshot gallery toggle
function toggleScreenshots(btn) {
  const card = btn.closest('.project-card');
  if (!card) return;
  const gallery = card.querySelector('.screenshots-gallery');
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  gallery.hidden = open;
}

// Lightbox state
let _lightboxThumbs = [];
let _lightboxIndex = 0;

function openLightbox(thumb) {
  const card = thumb.closest('.project-card');
  _lightboxThumbs = Array.from(card.querySelectorAll('.screenshot-thumb'));
  _lightboxIndex = _lightboxThumbs.indexOf(thumb);
  _showLightboxFrame(_lightboxIndex);
  document.getElementById('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}

function _showLightboxFrame(index) {
  const thumb = _lightboxThumbs[index];
  document.getElementById('lightbox-img').src = thumb.dataset.src;
  document.getElementById('lightbox-img').alt = thumb.dataset.caption || '';
  document.getElementById('lightbox-caption').textContent = thumb.dataset.caption || '';
  document.querySelector('.lightbox-prev').style.display = _lightboxThumbs.length > 1 ? '' : 'none';
  document.querySelector('.lightbox-next').style.display = _lightboxThumbs.length > 1 ? '' : 'none';
}

function lightboxNav(dir, e) {
  if (e) e.stopPropagation();
  _lightboxIndex = (_lightboxIndex + dir + _lightboxThumbs.length) % _lightboxThumbs.length;
  _showLightboxFrame(_lightboxIndex);
}

function closeLightbox(e) {
  if (e && e.target !== document.getElementById('lightbox') && !e.target.classList.contains('lightbox-close')) return;
  document.getElementById('lightbox').hidden = true;
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox');
  if (lb.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxNav(-1);
  if (e.key === 'ArrowRight') lightboxNav(1);
});

// Smooth scroll for nav anchor links (skip bare # hrefs)
document.querySelectorAll('a[href^="#"][href!="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Highlight active nav link based on scroll position
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const href = '#' + entry.target.id;
    const link = document.querySelector(`.nav-links a[href="${href}"]`);
    if (link) link.classList.toggle('active', entry.isIntersecting);
  });
}, { rootMargin: '-40% 0px -55% 0px' });

sections.forEach(s => observer.observe(s));

// Pre-warm the Streamlit app so it's live by the time the visitor clicks the link.
// Streamlit Community Cloud hibernates after inactivity; a HEAD request wakes it up.
// no-cors: Streamlit doesn't send CORS headers, so we can't read the response (that's fine).
// keepalive: survives navigation. Errors are silently ignored (best-effort only).
fetch('https://fiber-route-analyzer.streamlit.app/', { method: 'GET', mode: 'no-cors', keepalive: true })
  .catch(() => {});
