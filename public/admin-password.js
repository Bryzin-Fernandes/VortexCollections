const ADMIN_PAGE_API = window.Vortex.apiBase;

async function protectAdminPage() {
  if (!location.pathname.endsWith('/admin.html')) return true;
  document.querySelector('.admin-shell').hidden = true;
  const token = window.Vortex.token();
  if (!token) { location.replace('login.html?next=admin.html'); return false; }
  try {
    const response = await fetch(ADMIN_PAGE_API + '/api/me', { headers: { Authorization: 'Bearer ' + token } });
    const user = await response.json();
    if (!response.ok || user.is_admin !== true) { document.querySelector('#admin-access-message').textContent = 'Esta conta não possui permissão administrativa. Acesse a Área do Cliente pelo menu.'; return false; }
    document.querySelector('.admin-shell').hidden = false;
    document.querySelector('#admin-access-message').hidden = true;
    window.loadVortexAdmin();
    const supportScript = document.createElement('script'); supportScript.src = 'admin-support.js'; document.body.append(supportScript);
    return true;
  } catch (_) { document.querySelector('#admin-access-message').textContent = 'Não foi possível verificar sua permissão. Recarregue a página.'; return false; }
}

protectAdminPage().then(allowed => {
  if (!allowed) return;
  const passwordForm = document.querySelector('#password');
  passwordForm?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    try {
      const response = await fetch(ADMIN_PAGE_API + '/api/admin/users/' + encodeURIComponent(form.user_id.value) + '/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + window.Vortex.token() }, body: JSON.stringify({ password: form.new_password.value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Não foi possível alterar a senha.');
      form.reset(); document.querySelector('.portal-message').textContent = 'Senha alterada com sucesso.';
    } catch (error) { document.querySelector('.portal-message').textContent = error.message; }
  });
});
