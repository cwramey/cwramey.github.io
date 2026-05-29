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
