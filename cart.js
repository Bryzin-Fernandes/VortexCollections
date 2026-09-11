(() => {
  const V=window.Vortex,$=s=>document.querySelector(s),list=$('#cart-list'),checkout=$('#cart-checkout'),message=$('#cart-message');
  let catalog=V.meta,ready=false,summary=null,coupon='',generation=0,busy=false;
  const say=(text,error=false)=>{message.textContent=text;message.className='message'+(error?' error':'');};
  const items=()=>V.cart().map(slug=>catalog.find(p=>p.slug===slug)).filter(Boolean);
  function render(){list.replaceChildren();const entries=items();if(!entries.length){const empty=V.el('div',undefined,'empty-state');empty.innerHTML=V.icon('cart')+'<h3>Seu carrinho está esperando uma ideia.</h3><p>Explore nossos plugins e escolha como será a próxima aventura do seu servidor.</p><a class="btn btn-primary" href="index.html#produtos">Explorar plugins →</a>';list.append(empty);}entries.forEach(p=>{const row=V.el('article',undefined,'cart-row'),info=V.el('div',undefined,'cart-info');info.append(V.el('h3',p.name),V.el('small','Uma licença · Minecraft '+(p.minecraft_versions||'1.21')));const remove=V.el('button',undefined,'icon-button');remove.innerHTML=V.icon('close');remove.setAttribute('aria-label','Remover '+p.name);remove.onclick=()=>{if(busy)return;V.saveCart(V.cart().filter(s=>s!==p.slug));render();quote();};row.append(V.el('div',p.short,'product-initial '+p.color),info,V.el('strong',p.price_cents?V.money(p.price_cents):'Sob consulta'),remove);list.append(row);});const total=entries.reduce((s,p)=>s+Number(p.price_cents),0);$('#cart-subtotal').textContent=V.money(total);$('#cart-discount').textContent=summary?'- '+V.money(summary.discount_cents):'—';$('#cart-total').textContent=summary?V.money(summary.amount_cents):V.money(total);checkout.disabled=busy || !entries.length || (!ready && !!V.token()) || (!!V.token() && !summary);if(!V.token()){checkout.textContent='Entrar para concluir a compra →';say('Entre na sua conta para confirmar os preços e aplicar cupons.');}}
  async function quote(){summary=null;const seq=++generation;render();if(!V.cart().length){say('Adicione um plugin para continuar.');return;}if(!V.token())return;if(!ready)return;say('Conferindo preços e cupom…');try{const result=await V.request('/api/cart/quote',{method:'POST',body:JSON.stringify({items:V.cart(),coupon})});if(seq!==generation)return;summary=result;render();say('Preços confirmados. '+result.items.length+' plugin(s) no seu pedido.');$('#coupon-status').textContent=result.coupon?'Cupom '+result.coupon+' aplicado.':'';}catch(e){if(seq!==generation)return;render();say(e.message,true);}}
  $('#coupon-form').onsubmit=e=>{e.preventDefault();coupon=$('#coupon-code').value.trim().toUpperCase();localStorage.removeItem('vortex_checkout_request');quote();};
  $('#coupon-code').addEventListener('input',()=>{if(coupon!==$('#coupon-code').value.trim().toUpperCase()){$('#coupon-status').textContent='Clique em Aplicar para recalcular o desconto.';}});
  checkout.onclick=async()=>{
    if(!V.token()){location.href=V.loginLink('carrinho.html');return;}
    if(!summary || busy)return;
    if(coupon!==$('#coupon-code').value.trim().toUpperCase()){say('Aplique o cupom digitado antes de continuar.',true);return;}
    busy=true;render();say('Preparando seu pagamento…');const cart=V.cart();
    let key=localStorage.getItem('vortex_checkout_request');if(!key){key=crypto.randomUUID();localStorage.setItem('vortex_checkout_request',key);}
    try{const result=await V.request('/api/checkout',{method:'POST',body:JSON.stringify({items:cart,coupon,request_id:key})});
      if(result.approved){V.saveCart(V.cart().filter(s=>!cart.includes(s)));location.href='cliente.html#produtos';}
      else if(result.checkout_url && new URL(result.checkout_url).protocol==='https:'){localStorage.setItem('vortex_pending_cart',JSON.stringify({id:result.checkout_id,items:cart}));location.href=result.checkout_url;}else throw Error('Endereço de pagamento indisponível.');
    }catch(e){if(e.status===409)localStorage.removeItem('vortex_checkout_request');busy=false;render();say(e.message,true);}
  };
  render();
  V.request('/api/products').then(rows=>{catalog=V.meta.filter(p=>rows.some(r=>r.slug===p.slug)).map(p=>({...p,...rows.find(r=>r.slug===p.slug)}));const valid=new Set(catalog.map(p=>p.slug));const before=V.cart();if(before.some(s=>!valid.has(s))){V.saveCart(before.filter(s=>valid.has(s)));V.toast('Um produto indisponível foi removido do carrinho.');}ready=true;render();quote();}).catch(e=>{say(e.message+' Recarregue a página para tentar novamente.',true);});
})();
