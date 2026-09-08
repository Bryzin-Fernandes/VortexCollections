(() => {
  const API = 'https://vortexcollections-api.onrender.com';
  const token = localStorage.getItem('vortex_token');
  const main = document.querySelector('main');
  if (!main || !token) return;
  const style = document.createElement('style'); style.textContent = '.admin-support{margin-top:22px}.admin-support-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.admin-support-grid{display:grid;grid-template-columns:minmax(220px,.75fr) minmax(0,1.25fr);gap:18px;margin-top:20px}.ticket-select{display:flex;flex-direction:column;align-items:flex-start;gap:5px;text-align:left;width:100%;padding:15px;border:1px solid #75cbff2b;border-radius:10px;background:#0b1726;color:#fff;cursor:pointer}.ticket-select:hover,.ticket-select:focus-visible{border-color:#8ee5b9;background:#12243a;outline:none}.ticket-select small,.support-thread-meta{color:#9db2c8}.support-thread{min-height:230px;max-height:420px;overflow:auto;padding:16px;border:1px solid #75cbff2b;border-radius:12px;background:linear-gradient(180deg,#091320,#0d1d2d)}.support-empty{color:#9db2c8!important;text-align:center;padding:36px 12px}.support-thread-title{margin:0 0 4px!important}.support-thread-meta{display:block;margin-bottom:14px}.chat-message{max-width:84%;margin:10px 0;padding:12px 14px;border-radius:14px;background:#172d45;border:1px solid #75cbff2b}.chat-message.from-customer{margin-right:auto;border-bottom-left-radius:4px}.chat-message.from-staff{margin-left:auto;background:linear-gradient(135deg,#14543f,#1b7255);border-color:#8ee5b955;border-bottom-right-radius:4px}.chat-message strong{display:block;font-size:12px;color:#c9e9ff}.chat-message p{margin:5px 0;color:#fff;white-space:pre-wrap}.chat-message small{display:block;color:#b8cadb;font-size:10px}.support-reply{display:flex;gap:10px;margin-top:14px}.support-reply textarea{flex:1;min-height:70px;resize:vertical;padding:12px;background:#091320;color:#fff;border:1px solid #56758e;border-radius:7px;font:inherit}.support-reply .btn{align-self:flex-end}@media(max-width:720px){.admin-support-grid{grid-template-columns:1fr}.support-reply{flex-direction:column}.support-reply .btn{align-self:stretch}.admin-support-head{flex-direction:column}}'; document.head.append(style);
  const request = async (path, options = {}) => {
    const response = await fetch(API + path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o suporte.');
    return data;
  };
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const section = make('section', undefined, 'portal-card admin-support');
  section.innerHTML = '<div class="admin-support-head"><div><span class="section-kicker">CENTRAL DE ATENDIMENTO</span><h2>Chamados dos clientes</h2><p>Administradores e usuários da equipe de suporte podem abrir a conversa e responder por aqui.</p></div><button id="admin-support-refresh" class="btn btn-outline" type="button">Atualizar</button></div><div class="admin-support-grid"><div id="admin-ticket-list" class="portal-list"></div><div id="admin-ticket-thread" class="support-thread"><p class="support-empty">Selecione um chamado para visualizar a conversa.</p></div></div><form id="admin-ticket-reply" class="support-reply" hidden><textarea name="body" required maxlength="5000" placeholder="Digite uma resposta para o cliente..."></textarea><button class="btn btn-primary">Responder ao cliente</button></form>';
  main.insertBefore(section, main.querySelector('.portal-message') || null);
  const list = section.querySelector('#admin-ticket-list'), thread = section.querySelector('#admin-ticket-thread'), reply = section.querySelector('#admin-ticket-reply');
  let selected = null;
  function renderThread(data) {
    thread.replaceChildren();
    thread.append(make('h3', data.ticket.subject, 'support-thread-title'), make('small', 'Cliente: ' + (data.ticket.customer_name || data.ticket.email), 'support-thread-meta'));
    data.messages.forEach(message => { const bubble = make('article', undefined, 'chat-message ' + (message.author_id === data.ticket.user_id ? 'from-customer' : 'from-staff')); bubble.append(make('strong', message.author_name), make('p', message.body), make('small', new Date(message.created_at).toLocaleString('pt-BR'))); thread.append(bubble); });
    reply.hidden = false;
  }
  async function openTicket(id) { selected = id; try { renderThread(await request('/api/support/tickets/' + id)); } catch (error) { thread.replaceChildren(make('p', error.message, 'support-empty')); } }
  async function load() {
    try {
      const tickets = await request('/api/support/tickets'); list.replaceChildren();
      if (!tickets.length) list.append(make('p', 'Nenhum chamado aberto ainda.', 'support-empty'));
      tickets.forEach(ticket => { const row = make('button', undefined, 'ticket-select'); row.type = 'button'; row.append(make('strong', ticket.subject), make('small', (ticket.customer_name || ticket.email) + ' · ' + ticket.status)); row.addEventListener('click', () => openTicket(ticket.id)); list.append(row); });
    } catch (error) { list.replaceChildren(make('p', error.message, 'support-empty')); }
  }
  reply.addEventListener('submit', async event => { event.preventDefault(); if (!selected) return; const button = reply.querySelector('button'); button.disabled = true; try { await request('/api/support/tickets/' + selected + '/messages', { method: 'POST', body: JSON.stringify({ body: reply.body.value.trim() }) }); reply.reset(); await openTicket(selected); await load(); } catch (error) { alert(error.message); } finally { button.disabled = false; } });
  section.querySelector('#admin-support-refresh').addEventListener('click', load);
  load();
})();
