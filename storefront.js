(() => {
  const V=window.Vortex,grid=document.getElementById('product-grid');
  if(location.hash==='#cliente'){location.replace('cliente.html');return;}
  const params=new URLSearchParams(location.search);let search=(params.get('q') || '').trim().toLowerCase(),filter='Todos',products=V.meta;
  const clean=document.getElementById('clear-search');clean.hidden=!search;
  document.getElementById('header-q').value=search;
  function render(){
    grid.replaceChildren();
    const matches=products.filter(p=>(filter==='Todos'||p.category===filter) && (!search||(p.name+' '+p.description+' '+p.features.join(' ')).toLowerCase().includes(search)));
    for(const p of matches){
      const card=V.el('article',undefined,'product-card-new');
      const art=V.el('div',undefined,'product-art '+p.color);art.append(V.el('span',p.badge),V.el('strong',p.short),V.el('small','MINECRAFT '+(p.minecraft_versions || '1.8–1.21')));
      const body=V.el('div',undefined,'product-content');body.append(V.el('h3',p.name),V.el('p',p.description));
      const ul=V.el('ul',undefined,'product-features');p.features.forEach(f=>ul.append(V.el('li',f)));body.append(ul);
      const row=V.el('div',undefined,'product-purchase'),price=V.el('div',undefined,'product-price');price.append(V.el('strong',p.price_cents?V.money(p.price_cents):'Sob consulta'),V.el('small',p.price_cents?'compra individual':'fale com a equipe'));row.append(price);
      if(p.price_cents){const b=V.el('button','Adicionar','btn btn-primary');b.type='button';b.setAttribute('aria-label','Adicionar '+p.name+' ao carrinho');b.onclick=()=>V.add(p.slug);row.append(b);}else{const a=V.el('a','Consultar ↗','btn btn-outline');a.href='https://wa.me/5534998170791?text='+encodeURIComponent('Tenho interesse no '+p.name);a.target='_blank';a.rel='noopener';row.append(a);}body.append(row);card.append(art,body);grid.append(card);
    }
    if(!matches.length){const empty=V.el('div',undefined,'empty-state');empty.append(V.el('h3','Nenhum plugin encontrado.'),V.el('p','Tente buscar pelo nome ou escolha outra categoria.'));grid.append(empty);}
    else if(!search && filter==='Todos'){const help=V.el('aside',undefined,'catalog-help');help.innerHTML=V.icon('chat')+'<h3>Qual combina<br>com sua rede?</h3><p>Conte sua ideia. A gente ajuda você a escolher o próximo passo para o seu servidor.</p><a class="btn btn-outline" href="cliente.html#atendimentos">Conversar com a equipe →</a>';grid.append(help);}
  }
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(el=>{const active=el===b;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});render();});
  clean.onclick=()=>{search='';document.getElementById('header-q').value='';clean.hidden=true;history.replaceState(null,'','index.html#produtos');render();};
  render();if(search)document.getElementById('produtos').scrollIntoView();
  V.request('/api/products').then(rows=>{if(!Array.isArray(rows))throw Error();products=V.meta.filter(p=>rows.some(r=>r.slug===p.slug)).map(p=>({...p,...rows.find(r=>r.slug===p.slug)}));render();}).catch(()=>{document.getElementById('catalog-status').textContent='Os preços serão confirmados no carrinho. Se a conexão demorar, tente novamente.';});
})();
