(() => {
  const API = window.Vortex.apiBase;
  const token = window.Vortex.token();
  const main = document.querySelector('main');
  if (!main || !token) return;
  const request = (path, options = {}) => window.Vortex.request(path, options);
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const section = make('section', undefined, 'portal-card admin-support'); 
  section.innerHTML = '<div class="admin-support-head"><div><span class="section-kicker">CENTRAL DE ATENDIMENTO</span><h2>Chamados dos clientes</h2><p>Administradores e usuários da equipe de suporte podem abrir a conversa e responder por aqui.</p></div><button id="admin-support-refresh" class="btn btn-outline" type="button">Atualizar</button></div><div class="admin-support-grid"><div id="admin-ticket-list" class="portal-list"></div><div><div id="admin-ticket-thread" class="support-thread"><p class="support-empty">Selecione um chamado para visualizar a conversa.</p></div><div class="support-thread-actions"><button id="admin-ticket-close" class="btn btn-danger" type="button" disabled>Finalizar ticket</button></div></div></div><form id="admin-ticket-reply" class="support-reply" hidden><textarea aria-label="Resposta ao cliente" name="body" required maxlength="5000" placeholder="Digite uma resposta para o cliente..."></textarea><button class="btn btn-primary">Responder ao cliente</button></form>';
  const slot = document.querySelector('#admin-support-slot'); if (slot) slot.replaceWith(section); else main.insertBefore(section, main.querySelector('.portal-message') || null);
  const list = section.querySelector('#admin-ticket-list'), thread = section.querySelector('#admin-ticket-thread'), reply = section.querySelector('#admin-ticket-reply'), closeButton = section.querySelector('#admin-ticket-close');
  let selected = null;
  function renderThread(data) {
    thread.replaceChildren();
    thread.append(make('h3', data.ticket.subject, 'support-thread-title'), make('small', 'Cliente: ' + (data.ticket.customer_name || data.ticket.email) + ' · Status: ' + data.ticket.status, 'support-thread-meta'));
    data.messages.forEach(message => { const bubble = make('article', undefined, 'chat-message ' + (String(message.author_id) === String(data.ticket.user_id) ? 'from-customer' : 'from-staff')); bubble.append(make('strong', message.author_name), make('p', message.body), make('small', new Date(message.created_at).toLocaleString('pt-BR'))); thread.append(bubble); });
    reply.hidden = data.ticket.status === 'closed'; closeButton.disabled = data.ticket.status === 'closed'; closeButton.textContent = data.ticket.status === 'closed' ? 'Ticket finalizado' : 'Finalizar ticket'; closeButton.dataset.ticketId = data.ticket.id;
  }
  async function openTicket(id) { selected = id; try { renderThread(await request('/api/support/tickets/' + id)); } catch (error) { thread.replaceChildren(make('p', error.message, 'support-empty')); } }
  async function load() {
    try {
      const tickets = await request('/api/support/tickets'); list.replaceChildren();
      if (!tickets.length) list.append(make('p', 'Nenhum chamado aberto ainda.', 'support-empty'));
      tickets.forEach(ticket => { const row = make('button', undefined, 'ticket-select'); row.type = 'button'; row.append(make('strong', ticket.subject), make('small', (ticket.customer_name || ticket.email) + ' · ' + ticket.status)); row.addEventListener('click', () => openTicket(ticket.id)); list.append(row); });
    } catch (error) { list.replaceChildren(make('p', error.message, 'support-empty')); }
  }
  reply.addEventListener('submit', async event => { event.preventDefault(); if (!selected) return; const button = reply.querySelector('button'); button.disabled = true; try { await request('/api/support/tickets/' + selected + '/messages', { method: 'POST', body: JSON.stringify({ body: reply.body.value.trim() }) }); reply.reset(); await openTicket(selected); await load(); } catch (error) { window.Vortex.toast(error.message); } finally { button.disabled = false; } });
  closeButton.addEventListener('click', async () => { if (!selected || !confirm('Finalizar este ticket? O histórico continuará salvo, mas novas respostas serão bloqueadas.')) return; closeButton.disabled = true; try { await request('/api/support/tickets/' + selected + '/close', { method: 'POST', body: '{}' }); await openTicket(selected); await load(); } catch (error) { window.Vortex.toast(error.message); closeButton.disabled = false; } });
  section.querySelector('#admin-support-refresh').addEventListener('click', load);
  load();
})();
