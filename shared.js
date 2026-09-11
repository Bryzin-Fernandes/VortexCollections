(() => {
  'use strict';
  const meta = [
    { slug:'vortex-bedwars', name:'VortexBedWars', price_cents:15000, short:'BW', category:'Minigame', color:'rose', badge:'Novo lançamento', description:'Uma nova disputa para o seu servidor. Proteja sua cama, conquiste o mapa e jogue pela vitória.', features:['Minigame BedWars','Licença individual','Gerenciamento de IP pelo painel'] },
    { slug:'vortex-kitpvp', name:'VortexKitPvP', price_cents:12500, short:'KP', category:'PvP', color:'violet', badge:'Combate sem limites', description:'Transforme cada combate em uma experiência única, com kits e eventos para sua comunidade.', features:['Double Kit e Random Teleporte Kit','Espectador e leaderboard clicável','Evento FPS e 1v1'] },
    { slug:'vortex-feast', name:'VortexFeast', price_cents:2000, short:'FT', category:'Eventos', color:'emerald', badge:'A partir de R$ 20', description:'Um evento que faz o mapa inteiro se encontrar. Prepare seu servidor para a disputa pelo Feast.', features:['Cronômetro em holograma','Mobs protetores do Feast','Demonstração em vídeo disponível'] },
    { slug:'vortex-thepit', name:'VortexThePIT', price_cents:12500, short:'TP', category:'PvP', color:'amber', badge:'Evolua a cada partida', description:'Combates, progressão e recompensas para seus jogadores terem sempre um próximo objetivo.', features:['Cosméticos, nível e rank','Drop de gold, spawn e dinheiro','Leaderboard clicável'] },
    { slug:'vortex-skywars', name:'VortexSkyWars', price_cents:0, short:'SW', category:'Minigame', color:'sky', badge:'Seu próximo minigame', description:'Ilhas, desafios e diferentes formas de competir. Uma experiência completa para sua rede.', features:['Solo, dupla, trio, quarteto e Overpower','1v1, 2v2, 3v3, missões e desafios','Kits, habilidades, cosméticos e jaulas'] }
  ];
  meta.forEach(product => { product.minecraft_versions = '1.8–1.21'; });
  const V = window.Vortex = {
    meta, apiBase:window.VORTEX_CONFIG.apiBase.replace(/\/$/,''),
    token:()=>sessionStorage.getItem('vortex_token') || localStorage.getItem('vortex_token'),
    setSession(token,remember){sessionStorage.removeItem('vortex_token');localStorage.removeItem('vortex_token');(remember?localStorage:sessionStorage).setItem('vortex_token',token);},
    logout(){localStorage.removeItem('vortex_token');sessionStorage.removeItem('vortex_token');location.href='login.html';},
    money:n=>Number(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),
    date:v=>v?new Date(v).toLocaleDateString('pt-BR'):'—',
    el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;},
    async request(path,options={}){
      let response;
      try {response=await fetch(V.apiBase+path,{...options,signal:options.signal || AbortSignal.timeout(70000),headers:{'Content-Type':'application/json',...(V.token()?{Authorization:'Bearer '+V.token()}:{}),...options.headers}});}
      catch(e){throw Error('A conexão com a loja demorou ou foi interrompida. Tente novamente.');}
      const data=await response.json().catch(()=>({}));
      if(!response.ok){const error=Error(data.error || 'Não foi possível concluir esta ação.');error.status=response.status;throw error;}
      return data;
    },
    loginLink(next='cliente.html'){return 'login.html?next='+encodeURIComponent(next);},
    cart(){try{return JSON.parse(localStorage.getItem('vortex_cart') || '[]').filter(s=>typeof s==='string' && meta.some(p=>p.slug===s));}catch(_){return[];}},
    saveCart(items){localStorage.setItem('vortex_cart',JSON.stringify([...new Set(items)]));localStorage.removeItem('vortex_checkout_request');document.dispatchEvent(new Event('cartchange'));},
    add(slug){const items=V.cart();if(items.includes(slug))return V.toast('Este plugin já está no carrinho.');V.saveCart([...items,slug]);V.toast('Plugin adicionado ao carrinho.');},
    toast(message){let box=document.getElementById('site-toast');if(!box){box=V.el('div',undefined,'toast');box.id='site-toast';box.setAttribute('role','status');document.body.append(box);}box.textContent=message;box.classList.add('visible');clearTimeout(V.toastTimer);V.toastTimer=setTimeout(()=>box.classList.remove('visible'),4500);},
    avatar(nick,size=64){const img=V.el('img');img.className='mc-avatar';img.width=size;img.height=size;img.alt=nick?'Cabeça do Minecraft de '+nick:'Avatar da conta';img.referrerPolicy='no-referrer';img.src=nick?'https://mc-heads.net/avatar/'+encodeURIComponent(nick)+'/'+size:'avatar-default.svg';img.addEventListener('error',()=>{if(!img.src.endsWith('/avatar-default.svg'))img.src='avatar-default.svg';});return img;},
    icon(name){const paths={sun:'M12 3v1m0 16v1M3 12h1m16 0h1M5.6 5.6l.7.7m11.4 11.4.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',cart:'M3 3h2l2.5 12h10l3-8H6M10 20h.01M18 20h.01',user:'M20 21v-2a6 6 0 0 0-12 0v2M18 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',menu:'M4 6h16M4 12h16M4 18h16',arrow:'M5 12h14m-6-6 6 6-6 6',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',key:'M14 4a6 6 0 1 1-4 10l-7 7H1v-4l7-7a6 6 0 0 1 6-6M17 7h.01',chat:'M21 11a8 8 0 0 1-8 8H7l-5 3V9a7 7 0 0 1 7-7h4a8 8 0 0 1 8 9',box:'m3 6 9-4 9 4v12l-9 4-9-4V6m0 0 9 4 9-4M12 10v12',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4m-4 10 3 3 5-6',logout:'M9 3H3v18h6m5-14 5 5-5 5M8 12h11',check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',refresh:'M20 8V3l-4 4M4 16v5l4-4M20 8a8 8 0 0 0-14-3M4 16a8 8 0 0 0 14 3'};return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.box)+'"/></svg>';}
  };
  const header=document.getElementById('site-header') || document.querySelector('.nav-wrap');
  if(header){header.className='site-header';header.innerHTML=`<div class="header-inner"><a class="logo" href="index.html" aria-label="Vortex Collections, início"><span class="logo-symbol">V</span><span>vortex<span class="logo-sub">collections</span></span></a><nav class="header-nav" id="header-nav" aria-label="Navegação principal"><a href="index.html#produtos">Produtos</a><a href="planos.html">Planos</a><details><summary>Explore</summary><div class="nav-dropdown"><a href="equipe.html">Nossa equipe</a><a href="regras.html">Regras de uso</a><a href="cliente.html#atendimentos">Atendimento</a><a href="https://discord.gg/FabjYWPA9k" target="_blank" rel="noopener">Comunidade Discord ↗</a></div></details></nav><form class="header-search" action="index.html"><label class="sr-only" for="header-q">Buscar plugin</label>${V.icon('search')}<input id="header-q" name="q" placeholder="Encontre seu próximo plugin…" type="search"></form><div class="header-actions"><a class="account-link" href="cliente.html" id="header-account">${V.icon('user')}<span>Área do cliente</span></a><button class="icon-button" id="theme-toggle" aria-label="Alternar tema claro e escuro">${V.icon('sun')}</button><a class="icon-button cart-link" href="carrinho.html" aria-label="Abrir carrinho">${V.icon('cart')}<span id="cart-count" class="cart-count" hidden>0</span></a><button class="icon-button mobile-menu" id="menu-toggle" aria-expanded="false" aria-controls="header-nav" aria-label="Abrir menu">${V.icon('menu')}</button></div></div>`;
    document.getElementById('theme-toggle').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('vortex_theme',theme);document.dispatchEvent(new Event('themechange'));};
    document.getElementById('menu-toggle').onclick=e=>{const open=e.currentTarget.getAttribute('aria-expanded')!=='true';e.currentTarget.setAttribute('aria-expanded',String(open));document.getElementById('header-nav').classList.toggle('is-open',open);};
  }
  const count=()=>{const el=document.getElementById('cart-count');if(el){el.textContent=V.cart().length;el.hidden=!V.cart().length;}};count();document.addEventListener('cartchange',count);
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=V.icon(el.dataset.icon));
  const footer=document.getElementById('site-footer');if(footer)footer.innerHTML=`<div class="footer-top"><div><a class="logo" href="index.html"><span class="logo-symbol">V</span>vortex collections</a><p>Seu servidor tem potencial.<br>A gente ajuda a ir além.</p></div><div><strong>Explore</strong><a href="index.html#produtos">Nossos plugins</a><a href="planos.html">Planos mensais</a><a href="equipe.html">Nossa equipe</a></div><div><strong>Precisou? Estamos aqui.</strong><a href="cliente.html#atendimentos">Abrir atendimento</a><a href="https://discord.gg/FabjYWPA9k" target="_blank" rel="noopener">Discord ↗</a><a href="https://wa.me/5534998170791" target="_blank" rel="noopener">WhatsApp ↗</a></div></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} Vortex Collections.</span><a href="regras.html">Regras e licenciamento</a><span>Projeto independente, sem afiliação à Mojang ou Microsoft.</span></div>`;
  if(V.token()) V.userPromise=V.request('/api/me').then(user=>{const el=document.getElementById('header-account');if(el){el.replaceChildren(V.avatar(user.minecraft_nick,32),V.el('span',user.minecraft_nick || user.name));}return user;}).catch(e=>{if(e.status===401){localStorage.removeItem('vortex_token');sessionStorage.removeItem('vortex_token');}return null;});else V.userPromise=Promise.resolve(null);
})();

(() => {
  const footer = document.getElementById('site-footer');
  if (!footer || footer.querySelector('[data-company-registration]')) return;
  const company = document.createElement('div');
  company.className = 'footer-company';
  company.dataset.companyRegistration = 'true';
  company.innerHTML = '<span>Vortex Collections</span><span>CNPJ: 66.004.874/0001-25</span><span>Plugins para Minecraft · 1.8 até 1.21</span>';
  footer.append(company);
})();
