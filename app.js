const $ = (selector) => document.querySelector(selector);
const API_BASE = 'https://vortexcollections-api.onrender.com';
let selectedProduct = '';

async function apiRequest(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

const openModal = (id) => { const modal = $(id); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); };
const closeModals = () => document.querySelectorAll('.modal.open').forEach(m => {m.classList.remove('open');m.setAttribute('aria-hidden','true')});
document.querySelectorAll('[data-modal]').forEach(btn => btn.addEventListener('click', () => openModal('#'+btn.dataset.modal+'-modal')));
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModals));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {if(e.target===m) closeModals()}));
document.addEventListener('keydown', e => {if(e.key==='Escape') closeModals()});
const prices = { VortexKitPvP:'R$ 125', VortexFeast:'R$ 20', VortexThePIT:'R$ 125', VortexSkyWars:'Consulte' };
document.querySelectorAll('[data-buy]').forEach(btn => btn.addEventListener('click', () => { selectedProduct=btn.dataset.buy; $('#buy-title').textContent=selectedProduct==='VortexSkyWars'?'Interesse no '+selectedProduct:'Comprar '+selectedProduct; $('#buy-price').textContent=prices[selectedProduct]; $('#checkout-btn').textContent=selectedProduct==='VortexSkyWars'?'Falar com a Vortex →':'Continuar para pagamento →'; openModal('#buy-modal'); }));
$('#checkout-btn').addEventListener('click', async () => {
  if (selectedProduct === 'VortexSkyWars') { window.open('https://wa.me/5534998170791?text=Tenho%20interesse%20no%20VortexSkyWars','_blank'); return; }
  const token = localStorage.getItem('vortex_token');
  if (!token) { closeModals(); openModal('#login-modal'); alert('Faça login ou crie sua conta antes de comprar.'); return; }
  try {
    const result = await apiRequest('/api/checkout', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ product: selectedProduct }) });
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
    alert('Login realizado com sucesso.');
  } catch (error) { alert(error.message); }
});

$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fields = e.currentTarget.elements;
  try {
    const result = await apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: fields[0].value, email: fields[1].value, password: fields[2].value }) });
    localStorage.setItem('vortex_token', result.token);
    closeModals();
    alert('Conta criada com sucesso. Agora você já pode comprar seu plugin.');
  } catch (error) { alert(error.message); }
});
