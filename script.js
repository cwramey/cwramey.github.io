// === Screenshot lightbox =====================================================
// Each project's screenshots live in assets/screenshots/<project>/.
// openLightbox(project) is called from inline onclick handlers on the featured
// pane and on each portfolio card thumbnail.
const SCREENSHOTS = {
  project1: ['fiber_route1.png', 'fiber_route2.png', 'fiber_route3.png', 'fiber_route4.png', 'fiber_route5.png'],
  project2: ['gis_tool1.png', 'gis_tool2.png', 'gis_tool3.png', 'gis_tool4.png', 'gis_tool5.png'],
  project3: ['pdf_tool1.png', 'pdf_tool2.png', 'pdf_tool3.png'],
};

let _lbImages = [];
let _lbIndex = 0;

function openLightbox(project) {
  const files = SCREENSHOTS[project];
  if (!files || !files.length) return;
  _lbImages = files.map(f => `assets/screenshots/${project}/${f}`);
  _lbIndex = 0;
  _renderLightboxFrame();
  document.getElementById('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}

function _renderLightboxFrame() {
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  img.src = _lbImages[_lbIndex];
  img.alt = `Screenshot ${_lbIndex + 1} of ${_lbImages.length}`;
  const multi = _lbImages.length > 1;
  document.querySelector('.lightbox-prev').style.display = multi ? '' : 'none';
  document.querySelector('.lightbox-next').style.display = multi ? '' : 'none';
  cap.textContent = multi ? `${_lbIndex + 1} / ${_lbImages.length}` : '';
}

function lightboxNav(dir, e) {
  if (e) e.stopPropagation();
  if (!_lbImages.length) return;
  _lbIndex = (_lbIndex + dir + _lbImages.length) % _lbImages.length;
  _renderLightboxFrame();
}

function closeLightbox(e) {
  if (e && e.target !== document.getElementById('lightbox') && !e.target.classList.contains('lightbox-close')) return;
  document.getElementById('lightbox').hidden = true;
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox');
  if (!lb || lb.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxNav(-1);
  if (e.key === 'ArrowRight') lightboxNav(1);
});

// === Smooth scroll for in-page anchor links (skip bare "#") ==================
document.querySelectorAll('a[href^="#"]:not([href="#"])').forEach(link => {
  link.addEventListener('click', e => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// === Highlight active nav link based on scroll position ======================
const sections = document.querySelectorAll('section[id]');
const navObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const link = document.querySelector(`.nav-item[href="#${entry.target.id}"]`);
    if (link) link.classList.toggle('active', entry.isIntersecting);
  });
}, { rootMargin: '-40% 0px -55% 0px' });
sections.forEach(s => navObserver.observe(s));

// === Pre-warm the demo app ===================================================
// Streamlit Community Cloud hibernates after inactivity; a best-effort request
// wakes it so it's live by the time a visitor clicks "Launch Demo".
// no-cors: the app doesn't send CORS headers (we can't read the response — fine).
// keepalive: survives navigation. Errors are silently ignored.
fetch('https://fiber-route-analyzer.netlify.app/', { method: 'GET', mode: 'no-cors', keepalive: true })
  .catch(() => {});
