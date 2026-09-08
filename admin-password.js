const ADMIN_PAGE_API = 'https://vortexcollections-api.onrender.com';

async function protectAdminPage() {
  if (!location.pathname.endsWith('/admin.html')) return true;
  document.body.style.display = 'none';
  const token = localStorage.getItem('vortex_token');
  if (!token) { location.replace('index.html#cliente'); return false; }
  try {
    const response = await fetch(ADMIN_PAGE_API + '/api/me', { headers: { Authorization: 'Bearer ' + token } });
    const user = await response.json();
    if (!response.ok || user.is_admin !== true) { location.replace('index.html#cliente'); return false; }
    document.body.style.display = '';
    const supportScript = document.createElement('script'); supportScript.src = 'admin-support.js'; document.body.append(supportScript);
    return true;
  } catch (_) { location.replace('index.html#cliente'); return false; }
}

protectAdminPage().then(allowed => {
  if (!allowed) return;
  const passwordForm = document.querySelector('#password');
  passwordForm?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    try {
      const response = await fetch(ADMIN_PAGE_API + '/api/admin/users/' + encodeURIComponent(form.user_id.value) + '/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('vortex_token') }, body: JSON.stringify({ password: form.new_password.value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Não foi possível alterar a senha.');
      form.reset(); document.querySelector('.portal-message').textContent = 'Senha alterada com sucesso.';
    } catch (error) { document.querySelector('.portal-message').textContent = error.message; }
  });
});
