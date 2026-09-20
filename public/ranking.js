(() => {
  const V = window.Vortex;
  const app = document.querySelector('#ranking-app');
  const el = V.el;
  const card = customer => {
    const link = el('a', undefined, 'public-rank-card');
    link.href = 'perfil.html?id=' + encodeURIComponent(customer.id);
    const rank = el('span', '#' + customer.ranking, 'rank-number');
    const avatar = V.profileAvatar(customer, 64);
    const info = el('div', undefined, 'public-rank-info');
    info.append(el('strong', customer.minecraft_nick || customer.name), el('small', customer.minecraft_nick ? customer.name : 'Cliente Vortex'));
    const tags = el('div', undefined, 'actions');
    tags.append(el('span', customer.level.name, 'tag level-' + customer.level.tone), el('span', customer.plugin_count + ' plugin' + (customer.plugin_count === 1 ? '' : 's'), 'tag neutral'));
    info.append(tags);
    const total = el('strong', V.money(customer.spent_cents), 'rank-total');
    link.append(rank, avatar, info, total);
    return link;
  };
  async function boot() {
    try {
      const customers = await V.request('/api/public/ranking?limit=25');
      app.replaceChildren();
      if (!customers.length) {
        app.append(el('section', undefined, 'empty-state'));
        app.firstElementChild.append(el('h2', 'O ranking ainda está começando.'), el('p', 'Os clientes que optarem por exibir o perfil aparecerão aqui após uma compra aprovada.'));
        return;
      }
      const podium = el('section', undefined, 'ranking-podium');
      customers.slice(0, 3).forEach(customer => podium.append(card(customer)));
      const list = el('section', undefined, 'panel ranking-list');
      list.append(el('div', undefined, 'section-heading'));
      const heading = list.querySelector('.section-heading');
      heading.append(el('h2', 'Mais clientes'), el('p', 'Total gasto em compras aprovadas, do maior para o menor.'));
      customers.slice(3).forEach(customer => list.append(card(customer)));
      if (customers.length < 4) list.append(el('p', 'Você está vendo os primeiros colocados. Volte quando a comunidade crescer.', 'security-hint'));
      const note = el('p', 'Aparecem apenas clientes que ativaram a exibição do perfil público.','ranking-note');
      app.append(podium, list, note);
    } catch (error) {
      app.replaceChildren(el('p', error.message, 'message error'));
    }
  }
  boot();
})();
