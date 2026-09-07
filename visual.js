(() => {
  const discordUrl = 'https://discord.gg/FabjYWPA9k';
  function discordLink(className) {
    const a = document.createElement('a');
    a.href = discordUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = className; a.textContent = 'Discord ↗'; return a;
  }
  document.querySelector('.nav-links')?.append(discordLink(''));
  document.querySelector('.footer-inner')?.append(discordLink(''));
  document.querySelector('#customer-panel .customer-actions')?.append(discordLink('btn discord-btn'));
  // Contents remain visible when scripting or motion support is unavailable.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('is-visible'); observer.unobserve(entry.target);
      }
    }, { threshold: 0.06 });
    document.querySelectorAll('.product-card, .feature, .community, .rules-grid article').forEach(node => {
      node.classList.add('reveal-wait'); observer.observe(node);
    });
  }
})();
