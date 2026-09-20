(() => {
  const V = window.Vortex;
  const root = document.querySelector('#public-profile');
  const el = V.el;
  const id = new URLSearchParams(location.search).get('id');
  const levelPanel = profile => {
    const panel = el('section', undefined, 'panel public-progress');
    const heading = el('div', undefined, 'progress-heading');
    heading.append(el('div', '✦', 'progress-level-icon'), el('div'));
    heading.children[1].append(el('span', 'PROGRESSO', 'eyebrow'), el('h2', profile.level.name));
    const next = profile.level.next ? 'Próximo nível: ' + profile.level.next.name + ' · faltam ' + V.money(profile.level.to_next_cents) : 'Nível máximo alcançado.';
    panel.append(heading, el('p', next));
    const track = el('div', undefined, 'progress-track'), bar = el('span', undefined, 'progress-bar');
    bar.style.width = profile.level.progress_percent + '%'; track.append(bar); panel.append(track);
    const foot = el('div', undefined, 'progress-foot'); foot.append(el('span', profile.level.progress_percent + '% concluído'), el('span', 'Ranking #' + profile.ranking)); panel.append(foot);
    return panel;
  };
  const productCard = product => {
    const meta = V.meta.find(item => item.slug === product.slug) || { short: 'V', color: 'violet' };
    const card = el('article', undefined, 'public-product-card');
    card.append(el('div', meta.short, 'product-initial ' + meta.color));
    const info = el('div');
    info.append(el('h3', product.name), el('p', 'Minecraft ' + product.minecraft_versions), el('small', 'Adquirido em ' + V.date(product.purchased_at) + ' · ' + V.money(product.amount_cents)));
    card.append(info);
    return card;
  };
  async function boot() {
    if (!/^\d+$/.test(id || '')) { root.replaceChildren(el('div', undefined, 'empty-state')); root.firstElementChild.append(el('h2', 'Perfil não encontrado.'), el('p', 'O link deste perfil está incompleto.')); return; }
    try {
      const profile = await V.request('/api/public/users/' + encodeURIComponent(id));
      root.replaceChildren();
      const hero = el('section', undefined, 'profile-public-hero');
      const banner = el('div', undefined, 'profile-public-banner'), bannerImage = el('img');
      bannerImage.alt = 'Banner do perfil de ' + (profile.minecraft_nick || profile.name); bannerImage.src = profile.banner_url || 'avatar-default.svg'; bannerImage.onerror = () => { bannerImage.onerror = null; bannerImage.src = 'avatar-default.svg'; }; banner.append(bannerImage);
      const intro = el('div', undefined, 'profile-public-intro');
      intro.append(V.profileAvatar(profile, 108));
      const identity = el('div'); identity.append(el('span', 'PERFIL PÚBLICO', 'eyebrow'), el('h1', profile.minecraft_nick || profile.name), el('p', profile.minecraft_nick ? profile.name + ' · cliente Vortex' : 'Cliente Vortex'));
      const tags = el('div', undefined, 'actions'); tags.append(el('span', profile.level.name, 'tag level-' + profile.level.tone), el('span', '#' + profile.ranking + ' no ranking', 'tag neutral')); identity.append(tags); intro.append(identity); hero.append(banner, intro); root.append(hero);
      const metrics = el('div', undefined, 'metric-grid public-profile-metrics');
      metrics.append(el('article', undefined, 'metric-card')); metrics.children[0].append(el('strong', V.money(profile.spent_cents)), el('small', 'Total gasto'));
      metrics.append(el('article', undefined, 'metric-card')); metrics.children[1].append(el('strong', String(profile.plugin_count)), el('small', 'Plugins adquiridos'));
      metrics.append(el('article', undefined, 'metric-card')); metrics.children[2].append(el('strong', String(profile.purchase_count)), el('small', 'Compras aprovadas'));
      root.append(metrics, levelPanel(profile));
      const products = el('section', undefined, 'panel public-products'); products.append(el('h2', 'Plugins adquiridos'), el('p', 'Produtos que este cliente escolheu para a sua rede.'));
      const grid = el('div', undefined, 'public-products-grid'); if(profile.products.length) profile.products.forEach(product => grid.append(productCard(product))); else grid.append(el('p', 'Nenhum plugin público para exibir.', 'security-hint')); products.append(grid); root.append(products);
      const back = el('a', '← Voltar ao ranking', 'text-link'); back.href = 'ranking.html'; root.append(back);
      document.title = (profile.minecraft_nick || profile.name) + ' — Vortex Collections';
    } catch (error) {
      root.replaceChildren(el('div', undefined, 'empty-state')); root.firstElementChild.append(el('h2', 'Perfil indisponível.'), el('p', error.message), el('a', 'Voltar ao ranking', 'btn btn-primary')); root.firstElementChild.lastElementChild.href = 'ranking.html';
    }
  }
  boot();
})();
