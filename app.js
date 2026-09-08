const $ = (selector) => document.querySelector(selector);
const API_BASE = 'https://vortexcollections-api.onrender.com';
let selectedProduct = '';

async function apiRequest(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a operação.');
    error.status = response.status;
    throw error;
  }
  return data;
}

const openModal = (id) => { const modal = $(id); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); };
const closeModals = () => document.querySelectorAll('.modal.open').forEach(m => {m.classList.remove('open');m.setAttribute('aria-hidden','true')});
document.querySelectorAll('[data-modal]').forEach(btn => btn.addEventListener('click', () => {
  closeModals();
  if (btn.dataset.modal === 'login' && localStorage.getItem('vortex_token')) return showCustomer();
  openModal('#'+btn.dataset.modal+'-modal');
}));
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModals));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {if(e.target===m) closeModals()}));
document.addEventListener('keydown', e => {if(e.key==='Escape') closeModals()});
const prices = { VortexKitPvP:'R$ 125', VortexFeast:'R$ 20', VortexThePIT:'R$ 125', VortexSkyWars:'Consulte' };
const productSlugs = { VortexKitPvP:'vortex-kitpvp', VortexFeast:'vortex-feast', VortexThePIT:'vortex-thepit', VortexSkyWars:'vortex-skywars' };
document.querySelectorAll('[data-buy]').forEach(btn => btn.addEventListener('click', () => { selectedProduct=btn.dataset.buy; $('#buy-title').textContent=selectedProduct==='VortexSkyWars'?'Interesse no '+selectedProduct:'Comprar '+selectedProduct; $('#buy-price').textContent=prices[selectedProduct]; $('#checkout-btn').textContent=selectedProduct==='VortexSkyWars'?'Falar com a Vortex →':'Continuar para pagamento →'; openModal('#buy-modal'); }));
$('#checkout-btn').addEventListener('click', async () => {
  if (selectedProduct === 'VortexSkyWars') { window.open('https://wa.me/5534998170791?text=Tenho%20interesse%20no%20VortexSkyWars','_blank'); return; }
  const token = localStorage.getItem('vortex_token');
  if (!token) { closeModals(); openModal('#login-modal'); alert('Faça login ou crie sua conta antes de comprar.'); return; }
  try {
    const result = await apiRequest('/api/checkout', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ product: productSlugs[selectedProduct], coupon: $('#checkout-coupon').value.trim() }) });
    window.location.href = result.checkout_url;
  } catch (error) { alert(error.message); }
});

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fields = e.currentTarget.elements;
  try {
    const result = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: fields[0].value, password: fields[1].value }) });
    localStorage.setItem('vortex_token', result.token);
    closeModals();
    e.target.reset();
    await showCustomer();
  } catch (error) { alert(error.message); }
});

$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fields = e.currentTarget.elements;
  try {
    const result = await apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: fields[0].value, email: fields[1].value, password: fields[2].value }) });
    localStorage.setItem('vortex_token', result.token);
    closeModals();
    e.target.reset();
    await showCustomer();
  } catch (error) { alert(error.message); }
});


// Painel autenticado: produtos e permissões vêm da API, nunca do armazenamento local.
const customerStyle = document.createElement('link');
customerStyle.rel = 'stylesheet'; customerStyle.href = 'customer.css';
if (!document.querySelector('link[href="customer.css"]')) document.head.append(customerStyle);
const customerPanel = document.createElement('section');
customerPanel.id = 'customer-panel'; customerPanel.hidden = true;
customerPanel.innerHTML = `<div class="customer-head"><div><span class="section-kicker">VORTEX COLLECTIONS</span><h1>Minha área</h1><p id="customer-welcome"></p><p id="customer-account-id" class="customer-account-id">ID da conta: carregando...</p></div><div class="customer-actions"><button id="customer-store" class="btn btn-outline">Voltar à loja</button><button id="customer-refresh" class="btn btn-outline">Atualizar</button><button id="customer-logout" class="btn btn-outline">Sair</button></div></div>
<p id="customer-message" role="status" aria-live="polite"></p>
<h2>Meus plugins</h2><div id="customer-licenses" class="customer-grid"></div>
<h2>Meus pedidos</h2><div id="customer-orders"></div>
<details class="customer-reconcile"><summary>Já paguei, mas meu plugin não apareceu</summary><p>Use a mesma conta em que comprou. Digite o número do pagamento do Mercado Pago para consultar a aprovação.</p><form id="customer-reconcile"><label>Número do pagamento<input name="payment_id" inputmode="numeric" pattern="[0-9]+" required maxlength="30"></label><button class="btn btn-primary">Consultar pagamento</button></form></details>`;
document.querySelector('main').after(customerPanel);
const customerRules = document.createElement('a');
customerRules.href = 'regras.html'; customerRules.className = 'btn btn-outline'; customerRules.textContent = 'Regras';
customerPanel.querySelector('.customer-actions').append(customerRules);
const supportLink = element('a', 'Suporte', 'btn btn-outline'); supportLink.href = 'suporte.html'; customerPanel.querySelector('.customer-actions').append(supportLink);
const plansLink = element('a', 'Planos', 'btn btn-outline'); plansLink.href = 'planos.html'; customerPanel.querySelector('.customer-actions').append(plansLink);
let customerLoad = 0;
const customerMessage = text => { $('#customer-message').textContent = text; };
function customerRequest(path, options = {}) {
  return apiRequest(path, { ...options, headers: { Authorization: 'Bearer ' + localStorage.getItem('vortex_token'), ...options.headers } });
}
function returnToStore() {
  customerLoad++;
  customerPanel.hidden = true; document.querySelector('main').hidden = false;
  $('#customer-licenses').replaceChildren(); $('#customer-orders').replaceChildren();
  history.replaceState(null, '', '#produtos');
}
function customerError(error) {
  if (error.status === 401) {
    localStorage.removeItem('vortex_token'); returnToStore(); closeModals(); openModal('#login-modal');
    alert('Sua sessão expirou. Faça login novamente.'); return;
  }
  customerMessage(error.message || 'Serviço indisponível. Tente novamente.');
}
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function action(text, callback) {
  const button = element('button', text, 'btn btn-outline');
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await callback(); } catch (error) { customerError(error); } finally { button.disabled = false; }
  });
  return button;
}
function renderLicense(license) {
  const card = element('article', undefined, 'customer-card');
  card.append(element('span', license.status === 'active' ? 'Licença ativa' : 'Licença indisponível', 'customer-status'), element('h3', license.product), element('p', license.description));
  if (license.status !== 'active') { card.append(element('p', 'Entre em contato com o suporte para verificar esta licença.')); return card; }
  if (license.key) {
    const key = element('input'); key.readOnly = true; key.value = license.key; key.setAttribute('aria-label', 'Chave do ' + license.product);
    const label = element('label', 'Sua chave de licença'); label.append(key); card.append(label);
    card.append(action('Copiar chave', async () => { await navigator.clipboard.writeText(license.key); customerMessage('Chave copiada. Cole no config.yml do plugin.'); }));
  } else if (license.needs_reissue) {
    card.append(element('p', 'Sua compra é anterior ao painel. A chave antiga não pode ser exibida.'));
    card.append(action('Emitir nova chave', async () => {
      if (!confirm('A chave anterior deixará de funcionar. Emitir uma nova para esta licença?')) return;
      await customerRequest('/api/licenses/' + license.id + '/reissue', { method: 'POST', body: '{}' });
      await showCustomer(); customerMessage('Nova chave emitida. Atualize o config.yml do seu servidor.');
    }));
  } else card.append(element('p', 'Não foi possível abrir a chave. Contate o suporte; não altere LICENSE_SECRET.'));
  const ips = license.authorized_ips || [];
  card.append(element('h4', 'IP autorizado · ' + ips.length + '/1'));
  if (ips.length > 1) card.append(element('p', 'Esta licença possui IPs extras. Remova os extras e mantenha apenas um para liberar a validação do plugin.', 'ip-warning'));
  const list = element('ul');
  for (const ip of ips) {
    const item = element('li'); item.append(element('code', ip), action('Remover', async () => {
      if (!confirm('Remover este IP? O plugin nesse servidor perderá a autorização.')) return;
      await customerRequest('/api/licenses/' + license.id + '/ip', { method: 'DELETE', body: JSON.stringify({ ip }) }); await showCustomer();
    })); list.append(item);
  }
  if (!list.children.length) list.append(element('li', 'Nenhum IP autorizado.'));
  card.append(list, element('p', 'Cadastre o IP público de saída do servidor, sem porta. Pode ser diferente do endereço usado para jogar.'));
  card.append(element('p', 'Uma licença permite um único IP por vez. Para trocar de hospedagem, remova o IP antigo e autorize o novo.'));
  const form = element('form');
  const label = element('label', 'IP do servidor'); const input = element('input'); input.required = true; input.placeholder = '203.0.113.10 ou IPv6'; label.append(input);
  const submit = element('button', 'Autorizar IP', 'btn btn-outline'); submit.type = 'submit'; form.append(label, submit);
  input.disabled = submit.disabled = ips.length > 0;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (ips.length > 0) return; submit.disabled = true;
    try { await customerRequest('/api/licenses/' + license.id + '/ip', { method: 'POST', body: JSON.stringify({ ip: input.value.trim() }) }); await showCustomer(); }
    catch (error) { customerError(error); } finally { submit.disabled = false; }
  }); card.append(form);
  const download = action('Baixar ' + license.product, async () => {
    const response = await fetch(API_BASE + '/api/licenses/' + license.id + '/download', { headers: { Authorization: 'Bearer ' + localStorage.getItem('vortex_token') } });
    if (!response.ok) { const data = await response.json().catch(() => ({})); const error = new Error(data.error || 'Falha no download.'); error.status = response.status; throw error; }
    const url = URL.createObjectURL(await response.blob());
    const a = element('a'); a.href = url; a.download = license.slug + '.jar'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  download.disabled = !license.download_available; card.append(download);
  if (!license.download_available) card.append(element('small', 'Arquivo ainda não disponibilizado pelo vendedor.'));
  return card;
}
async function showCustomer() {
  if (!localStorage.getItem('vortex_token')) { closeModals(); openModal('#login-modal'); return; }
  closeModals(); customerPanel.hidden = false; document.querySelector('main').hidden = true;
  history.replaceState(null, '', '#cliente'); window.scrollTo(0, 0);
  const load = ++customerLoad;
  customerMessage('Carregando suas compras… A API gratuita pode demorar para responder.');
  $('#customer-licenses').replaceChildren(); $('#customer-orders').replaceChildren();
  try {
    const [user, licenses, orders] = await Promise.all([customerRequest('/api/me'), customerRequest('/api/me/licenses'), customerRequest('/api/me/orders')]);
    if (load !== customerLoad) return;
    $('#customer-welcome').textContent = user.name + ' · ' + user.email;
    $('#customer-account-id').textContent = 'ID da conta: ' + user.id;
    if (user.role === 'admin' && !customerPanel.querySelector('[data-admin-link]')) { const adminLink = element('a', 'Administração', 'btn btn-outline'); adminLink.href = 'admin.html'; adminLink.dataset.adminLink = 'true'; customerPanel.querySelector('.customer-actions').append(adminLink); }
    if (!licenses.length) $('#customer-licenses').append(element('p', 'Nenhum plugin liberado ainda. Veja o status dos seus pedidos abaixo.'));
    else licenses.forEach(license => $('#customer-licenses').append(renderLicense(license)));
    const statuses = { approved: 'Aprovado', pending: 'Aguardando pagamento', rejected: 'Recusado', cancelled: 'Cancelado' };
    if (!orders.length) $('#customer-orders').append(element('p', 'Você ainda não tem pedidos.'));
    orders.forEach(order => { const row = element('div', undefined, 'customer-order'); row.append(element('strong', '#' + order.id + ' · ' + order.product), element('span', statuses[order.status] || order.status), element('span', (order.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))); $('#customer-orders').append(row); });
    customerMessage('Dados atualizados.');
  } catch (error) { if (load === customerLoad) customerError(error); }
}
$('#customer-store').onclick = returnToStore;
$('#customer-refresh').onclick = showCustomer;
$('#customer-logout').onclick = () => { localStorage.removeItem('vortex_token'); returnToStore(); $('#customer-welcome').textContent = ''; };
$('#customer-reconcile').onsubmit = async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try { await customerRequest('/api/me/reconcile', { method: 'POST', body: JSON.stringify({ payment_id: event.currentTarget.elements.payment_id.value }) }); await showCustomer(); }
  catch (error) { customerError(error); } finally { button.disabled = false; }
};
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', () => { if (!customerPanel.hidden) returnToStore(); }));
if (location.hash === '#cliente') showCustomer();
const chatStyle = document.createElement('style');
chatStyle.textContent = '.vortex-chat{position:fixed;right:24px;bottom:24px;z-index:20;font-family:var(--font)}.vortex-chat-toggle{width:62px;height:62px;border:0;border-radius:50%;background:linear-gradient(145deg,#8ee5b9,#4dbb8d);color:#072018;font-size:25px;cursor:pointer;box-shadow:0 12px 32px #0008,0 0 0 7px #8ee5b922;transition:.2s}.vortex-chat-toggle:hover{transform:translateY(-3px) scale(1.04)}.vortex-chat-panel{display:none;width:min(340px,calc(100vw - 32px));margin-bottom:14px;padding:19px;border:1px solid #8ee5b966;border-radius:18px;background:linear-gradient(145deg,#102b2a,#0d1826);box-shadow:0 22px 60px #000b}.vortex-chat.open .vortex-chat-panel{display:block}.vortex-chat-panel h3{margin:0 0 5px;color:#fff;font-size:20px}.vortex-chat-panel p{color:#b8cadb;font-size:12px;line-height:1.5;margin:0 0 14px}.vortex-chat-panel textarea{width:100%;box-sizing:border-box;min-height:82px;resize:vertical;padding:11px;border-radius:10px;border:1px solid #75cbff55;background:#07131f;color:#fff;font:inherit}.vortex-chat-panel .chat-actions{display:flex;gap:8px;margin-top:10px}.vortex-chat-panel .chat-actions button,.vortex-chat-panel .chat-actions a{flex:1}.vortex-chat-status{min-height:18px;color:#9ae4c5;font-size:11px;margin-top:9px}.vortex-chat-status.error{color:#ffaaa0}@media(max-width:600px){.vortex-chat{right:16px;bottom:16px}.vortex-chat-toggle{width:56px;height:56px}}';
document.head.append(chatStyle);
const chat = document.createElement('div'); chat.className = 'vortex-chat';
chat.innerHTML = '<div class="vortex-chat-panel"><h3>Fale com a Vortex</h3><p>Envie sua dúvida diretamente para a equipe. A conversa ficará registrada na sua área de suporte.</p><form><textarea name="message" required maxlength="5000" placeholder="Como podemos ajudar?"></textarea><div class="chat-actions"><button class="btn btn-primary" type="submit">Enviar</button><a class="btn btn-outline" href="suporte.html">Ver suporte</a></div><div class="vortex-chat-status" aria-live="polite"></div></form></div><button class="vortex-chat-toggle" type="button" aria-label="Abrir conversa com o suporte">◌</button>';
document.body.append(chat);
chat.querySelector('.vortex-chat-toggle').addEventListener('click', () => chat.classList.toggle('open'));
chat.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); const status = chat.querySelector('.vortex-chat-status'); const form = event.currentTarget; const token = localStorage.getItem('vortex_token'); if (!token) { chat.classList.remove('open'); openModal('#login-modal'); alert('Entre na sua conta para conversar com o suporte.'); return; } const button = form.querySelector('button'); button.disabled = true; status.classList.remove('error'); status.textContent = 'Enviando…'; try { await apiRequest('/api/support/tickets', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ subject: 'Atendimento pelo site', message: form.message.value.trim() }) }); form.reset(); status.textContent = 'Mensagem enviada. A equipe responderá na Área de Suporte.'; } catch (error) { status.classList.add('error'); status.textContent = error.message; } finally { button.disabled = false; } });
