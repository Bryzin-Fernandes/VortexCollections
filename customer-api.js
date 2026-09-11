const net = require('net');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const details = {
  'vortex-bedwars': 'Minigame BedWars para o seu servidor Minecraft.',
  'vortex-kitpvp': 'Espectador, Double Kit, Random Teleporte Kit, leaderboard clicável, evento FPS e 1v1.',
  'vortex-feast': 'Cronômetro em holograma e mobs protetores do Feast.',
  'vortex-thepit': 'Cosméticos, nível, rank, drop de gold, spawn, dinheiro e leaderboard clicável.',
  'vortex-skywars': 'Solo, dupla, trio, quarteto, 1v1, 2v2, 3v3, Overpower, missões, desafios, cosméticos, kits, habilidades e jaulas personalizadas.'
};
const downloadEnv = { 'vortex-bedwars': 'DOWNLOAD_BEDWARS_URL', 'vortex-kitpvp': 'DOWNLOAD_KITPVP_URL', 'vortex-feast': 'DOWNLOAD_FEAST_URL', 'vortex-thepit': 'DOWNLOAD_THEPIT_URL', 'vortex-skywars': 'DOWNLOAD_SKYWARS_URL' };
function paymentMatches(payment, order) {
  return String(payment.external_reference) === String(order.order_id)
    && payment.currency_id === 'BRL'
    && Number(order.amount_cents) > 0
    && Math.round(Number(payment.transaction_amount) * 100) === Number(order.amount_cents)
    && Number(payment.transaction_amount_refunded || 0) === 0;
}
function install({ app, pool, auth, bcrypt, vault, fingerprint, createLicenseKey, mercadoPago, provisionLicense, confirmCartPayment }) {
  // Render: um proxy de entrada confiável. Fora do Render, configure a topologia antes de usar.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(error => {
    console.error('Área do cliente:', error.code || error.name);
    if (!res.headersSent) res.status(500).json({ error: 'Não foi possível concluir. Tente novamente.' });
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const owned = async (user, id, client = pool) => (await client.query(`
    SELECT l.*, p.slug, p.name, o.status AS order_status
    FROM licenses l JOIN products p ON p.id=l.product_id JOIN orders o ON o.id=l.order_id
    WHERE l.id=$1 AND l.user_id=$2 AND l.status='active' AND o.status='approved' AND (l.source <> 'subscription' OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=l.subscription_id AND s.status='active' AND s.current_period_end>NOW()))
  `, [id, user])).rows[0];
  app.get('/api/me', auth, wrap(async (req, res) => {
    const user = (await pool.query('SELECT id,name,email,role,minecraft_nick,created_at FROM users WHERE id=$1', [req.user.sub])).rows[0];
    if (!user) return res.status(401).json({ error: 'Conta não encontrada.' });
    const isSupport = (await pool.query('SELECT 1 FROM support_agents WHERE user_id=$1 AND active=TRUE', [user.id])).rowCount > 0;
    res.json({ ...user, is_support: isSupport, is_admin: user.role === 'admin' && Boolean(process.env.ADMIN_USER_ID) && String(user.id) === String(process.env.ADMIN_USER_ID) });
  }));
  app.get('/api/me/orders', auth, wrap(async (req, res) => {
    res.json((await pool.query(`SELECT o.id,o.status,o.amount_cents,o.created_at,p.name AS product
      FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=$1 ORDER BY o.id DESC LIMIT 100`, [req.user.sub])).rows);
  }));
  app.get('/api/me/licenses', auth, wrap(async (req, res) => {
    const rows = (await pool.query(`SELECT l.id,l.status,l.order_id,l.key_encrypted,l.created_at,p.slug,p.name AS product,
      o.status AS order_status,l.source,p.minecraft_versions,s.current_period_end AS expires_at,s.status AS subscription_status,
      COALESCE((SELECT json_agg(host(ai.ip_address)) FROM authorized_ips ai WHERE ai.license_id=l.id),'[]') AS authorized_ips
      FROM licenses l JOIN products p ON p.id=l.product_id JOIN orders o ON o.id=l.order_id LEFT JOIN subscriptions s ON s.id=l.subscription_id
      WHERE l.user_id=$1 ORDER BY l.id DESC`, [req.user.sub])).rows;
    res.json(rows.map(row => {
      const active = row.status === 'active' && row.order_status === 'approved' && (row.source !== 'subscription' || (row.subscription_status === 'active' && new Date(row.expires_at) > new Date()));
      let key = null;
      let key_error = false;
      if (active && row.key_encrypted) {
        try { key = vault.decrypt(row.key_encrypted, row.order_id); } catch (_) { key_error = true; }
      }
      return { id: row.id, product: row.product, slug: row.slug, status: active ? 'active' : row.status === 'active' ? 'suspended' : row.status,
        source: row.source || 'purchase', expires_at: row.expires_at, minecraft_versions: row.minecraft_versions || '1.21', description: details[row.slug] || '', created_at: row.created_at, authorized_ips: row.authorized_ips,
        key, key_error, needs_reissue: active && !row.key_encrypted,
        download_available: active && Boolean(process.env[downloadEnv[row.slug]]) };
    }));
  }));
  app.post('/api/licenses/:id/reissue', auth, wrap(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM licenses WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.sub]);
      const license = await owned(req.user.sub, req.params.id, client);
      if (!license) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Licença indisponível.' }); }
      if (license.key_encrypted) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Esta licença já possui uma chave recuperável.' }); }
      const key = createLicenseKey(license.slug);
      await client.query('UPDATE licenses SET license_key_hash=$1,license_key_fingerprint=$2,key_encrypted=$3 WHERE id=$4',
        [await bcrypt.hash(key, 12), fingerprint(key), vault.encrypt(key, license.order_id), license.id]);
      await client.query('COMMIT');
      res.json({ key });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.post('/api/licenses/:id/ip', auth, wrap(async (req, res) => {
    const ip = typeof req.body.ip === 'string' ? req.body.ip.trim() : '';
    if (!net.isIP(ip) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Informe um IPv4 ou IPv6, sem porta, domínio ou máscara.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM licenses WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.sub]);
      if (!await owned(req.user.sub, req.params.id, client)) {
        await client.query('ROLLBACK'); return res.status(404).json({ error: 'Licença indisponível.' });
      }
      const existing = (await client.query('SELECT ip_address=$2::inet AS same FROM authorized_ips WHERE license_id=$1', [req.params.id, ip])).rows;
      if (existing.length > 1 || (existing.length === 1 && !existing[0].same)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cada licença permite apenas um IP. Remova o IP anterior antes de autorizar outro.' });
      }
      if (!existing.length) await client.query('INSERT INTO authorized_ips (license_id,ip_address) VALUES ($1,$2::inet)', [req.params.id, ip]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.delete('/api/licenses/:id/ip', auth, wrap(async (req, res) => {
    const ip = typeof req.body.ip === 'string' ? req.body.ip.trim() : '';
    if (!net.isIP(ip) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'IP inválido.' });
    if (!await owned(req.user.sub, req.params.id)) return res.status(404).json({ error: 'Licença indisponível.' });
    await pool.query('DELETE FROM authorized_ips WHERE license_id=$1 AND ip_address=$2::inet', [req.params.id, ip]);
    res.json({ ok: true });
  }));
  app.get('/api/licenses/:id/download', auth, wrap(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    const license = await owned(req.user.sub, req.params.id);
    if (!license) return res.status(404).json({ error: 'Compra aprovada e licença ativa são necessárias.' });
    // Apenas origem definida pelo administrador em variável privada; nunca URL enviada pelo cliente.
    const source = process.env[downloadEnv[license.slug]];
    if (!source) return res.status(503).json({ error: 'O vendedor ainda não disponibilizou este arquivo.' });
    if (new URL(source).protocol !== 'https:') return res.status(503).json({ error: 'Download não configurado corretamente.' });
    const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) return res.status(502).json({ error: 'Arquivo temporariamente indisponível.' });
    res.set('Content-Type', 'application/java-archive');
    res.set('Content-Disposition', `attachment; filename="${license.slug}.jar"`);
    await pipeline(Readable.fromWeb(response.body), res);
  }));
  app.post('/api/license/verify', wrap(async (req, res) => {
    const { key, product } = req.body || {};
    // Não confia no IP declarado pelo plugin: usa o IP de origem observado pelo proxy confiável.
    const observed = (req.ip || '').replace(/^::ffff:/, '');
    const sendJson = res.json.bind(res);
    res.json = body => sendJson({ ...body, server_ip: observed });
    if (typeof key !== 'string' || key.length > 160 || typeof product !== 'string' || !net.isIP(observed))
      return res.status(400).json({ valid: false, ip_authorized: false });
    const license = (await pool.query(`SELECT l.id,l.license_key_hash FROM licenses l JOIN products p ON p.id=l.product_id
      JOIN orders o ON o.id=l.order_id WHERE l.license_key_fingerprint=$1 AND p.slug=$2
      AND l.status='active' AND o.status='approved' AND (l.source <> 'subscription' OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=l.subscription_id AND s.status='active' AND s.current_period_end>NOW()))`, [fingerprint(key.trim()), product])).rows[0];
    if (!license || !await bcrypt.compare(key.trim(), license.license_key_hash)) return res.status(403).json({ valid: false, ip_authorized: false });
    const result = await pool.query('UPDATE authorized_ips SET last_seen_at=NOW() WHERE license_id=$1 AND ip_address=$2::inet AND (SELECT COUNT(*) FROM authorized_ips WHERE license_id=$1)=1 RETURNING id', [license.id, observed]);
    res.status(result.rowCount ? 200 : 403).json({ valid: true, ip_authorized: Boolean(result.rowCount) });
  }));
  async function confirmPayment(id, owner) {
    const payment = await mercadoPago('/v1/payments/' + encodeURIComponent(id));
    if (String(payment.external_reference || '').startsWith('cart:')) return confirmCartPayment(payment, owner);
    if (!/^\d+$/.test(String(payment.external_reference))) return false;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = (await client.query(`SELECT o.id AS order_id,o.user_id,o.product_id,o.amount_cents,o.payment_id,p.slug AS product_slug
        FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=$1 FOR UPDATE OF o`, [payment.external_reference])).rows[0];
      if (!order || (owner && String(order.user_id) !== String(owner)) || (order.payment_id && String(order.payment_id) !== String(payment.id))) {
        await client.query('ROLLBACK'); return false;
      }
      if (String(order.payment_id) === String(payment.id) && (['refunded','charged_back','cancelled'].includes(payment.status) || Number(payment.transaction_amount_refunded || 0) > 0)) {
        await client.query("UPDATE orders SET status='cancelled' WHERE id=$1", [order.order_id]);
        await client.query("UPDATE licenses SET status='suspended' WHERE order_id=$1", [order.order_id]);
        await client.query('COMMIT'); return false;
      }
      if (!paymentMatches(payment, order) || payment.status !== 'approved') {
        await client.query('ROLLBACK'); return false;
      }
      await client.query("UPDATE orders SET status='approved',payment_id=$1 WHERE id=$2", [String(payment.id), order.order_id]);
      await provisionLicense(client, order);
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  app.post('/api/me/reconcile', auth, wrap(async (req, res) => {
    const id = String(req.body.payment_id || '');
    if (!/^\d{1,30}$/.test(id)) return res.status(400).json({ error: 'Informe o número do pagamento do Mercado Pago.' });
    const approved = await confirmPayment(id, req.user.sub);
    if (!approved) return res.status(409).json({ error: 'Pagamento não aprovado ou não corresponde a um pedido desta conta.' });
    res.json({ ok: true });
  }));
  app.post('/api/mercadopago/webhook', wrap(async (req, res) => {
    const id = String(req.body?.data?.id || req.query['data.id'] || '');
    if (!/^\d{1,30}$/.test(id)) return res.sendStatus(200);
    // Consulta autenticada ao MP: o corpo da notificação nunca autoriza a compra sozinho.
    await confirmPayment(id);
    res.sendStatus(200);
  }));
  for (const route of ['/sucesso', '/pendente', '/falha']) app.get(route, (_req, res) => {
    const origin = (process.env.CORS_ORIGIN || '').split(',')[0].trim();
    if (!origin.startsWith('https://')) return res.status(503).send('Volte para a loja e abra a área do cliente.');
    const q = new URLSearchParams({ pagamento: route.slice(1) });
    if (/^\d{1,30}$/.test(String(_req.query.payment_id || ''))) q.set('payment_id', String(_req.query.payment_id));
    res.redirect(origin + '/cliente.html?' + q);
  });
}
module.exports = install;
module.exports.paymentMatches = paymentMatches;
