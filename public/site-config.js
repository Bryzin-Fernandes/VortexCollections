// Apenas endereço público. Segredos ficam nas variáveis de ambiente da API.
window.VORTEX_CONFIG = { apiBase: 'https://vortexcollections-api.onrender.com' };
try { document.documentElement.dataset.theme = localStorage.getItem('vortex_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (_) { document.documentElement.dataset.theme = 'dark'; }
