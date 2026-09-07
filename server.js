require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 10000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(v => v.trim()) : true }));
app.use(express.json({ limit: '100kb' }));

const products = new Map([
  ['vortex-kitpvp', { name: 'VortexKitPvP', price: 12500 }],
  ['vortex-feast', { name: 'VortexFeast', price: 2000 }],
  ['vortex-thepit', { name: 'VortexThePIT', price: 12500 }],
  ['vortex-skywars', { name: 'VortexSkyWars', price: 0 }]
]);

function requiredEnv() {
  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'LICENSE_SECRET', 'MP_ACCESS_TOKEN']) {
    if (!process.env[name]) throw new Error(`Variável ausente: ${name}`);
  }
}

function issueToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.substring(7) : '';
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (_) {
    res.status(401).json({ error: 'Não autenticado.' });
  }
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(`${process.env.LICENSE_SECRET}:${value}`).digest('hex');
}

function createLicenseKey(productSlug) {
  const prefix = productSlug.replace('vortex-', 'VTX').toUpperCase();
  const raw = crypto.randomBytes(12).toString('hex').toUpperCase();
  return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 24)}`;
}

async function mercadoPago(path, options = {}) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mercado Pago HTTP ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function provisionLicense(client, order) {
  const key = createLicenseKey(order.product_slug);
  const keyHash = await bcrypt.hash(key, 12);
  const result = await client.query(`
    INSERT INTO licenses (order_id, user_id, product_id, license_key_fingerprint, license_key_hash)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id
  `, [order.order_id, order.user_id, order.product_id, fingerprint(key), keyHash]);
  return result.rowCount ? key : null;
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'vortex-api' }); }
  catch (_) { res.status(503).json({ ok: false }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Nome, e-mail e senha de 8 caracteres são obrigatórios.' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query('INSERT INTO users (name, email, password_hash) VALUES ($1, LOWER($2), $3) RETURNING id, name, email, role', [name.trim(), email.trim(), hash]);
    res.status(201).json({ user: rows[0], token: issueToken(rows[0]) });
  } catch (error) {
    res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'E-mail já cadastrado.' : 'Não foi possível criar a conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query('SELECT id, name, email, role, password_hash FROM users WHERE email = LOWER($1)', [email || '']);
  if (!rows[0] || !(await bcrypt.compare(password || '', rows[0].password_hash))) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  const user = rows[0]; delete user.password_hash;
  res.json({ user, token: issueToken(user) });
});

app.post('/api/checkout', auth, async (req, res) => {
  const { product: slug } = req.body || {};
  const product = products.get(slug);
  if (!product || product.price === 0) return res.status(400).json({ error: 'Produto inválido ou sem preço definido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const productRow = (await client.query('SELECT id, name, price_cents FROM products WHERE slug = $1 AND active = TRUE', [slug])).rows[0];
    const order = (await client.query('INSERT INTO orders (user_id, product_id, amount_cents) VALUES ($1, $2, $3) RETURNING id', [req.user.sub, productRow.id, productRow.price_cents])).rows[0];
    const preference = await mercadoPago('/checkout/preferences', { method: 'POST', body: JSON.stringify({
      items: [{ id: slug, title: productRow.name, quantity: 1, currency_id: 'BRL', unit_price: productRow.price_cents / 100 }],
      external_reference: String(order.id), notification_url: `${process.env.PUBLIC_URL}/api/mercadopago/webhook`,
      back_urls: { success: `${process.env.PUBLIC_URL}/sucesso`, failure: `${process.env.PUBLIC_URL}/falha`, pending: `${process.env.PUBLIC_URL}/pendente` }
    }) });
    await client.query('UPDATE orders SET mercado_pago_id = $1 WHERE id = $2', [preference.id, order.id]);
    await client.query('COMMIT');
    res.status(201).json({ checkout_url: preference.init_point, order_id: order.id });
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: 'Não foi possível criar o checkout.' }); }
  finally { client.release(); }
});

app.post('/api/mercadopago/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const paymentId = req.body?.data?.id || req.query['data.id'];
    if (!paymentId) return;
    const payment = await mercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`);
    if (payment.status !== 'approved') return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = (await client.query(`SELECT o.id AS order_id, o.user_id, o.product_id, p.slug AS product_slug FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=$1 FOR UPDATE`, [payment.external_reference])).rows[0];
      if (!order) throw new Error('Pedido não encontrado.');
      await client.query('UPDATE orders SET status = \'approved\' WHERE id = $1', [order.order_id]);
      const key = await provisionLicense(client, order);
      await client.query('COMMIT');
      if (key) console.log(`Licença criada para o pedido ${order.order_id}: ${key}`);
    } catch (error) { await client.query('ROLLBACK'); console.error(error); }
    finally { client.release(); }
  } catch (error) { console.error('Webhook Mercado Pago:', error.message); }
});

app.get('/api/me/licenses', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT l.id, l.status, p.name AS product, l.created_at, COALESCE(json_agg(ai.ip_address) FILTER (WHERE ai.id IS NOT NULL), '[]') AS authorized_ips FROM licenses l JOIN products p ON p.id=l.product_id LEFT JOIN authorized_ips ai ON ai.license_id=l.id WHERE l.user_id=$1 GROUP BY l.id, p.name ORDER BY l.created_at DESC`, [req.user.sub]);
  res.json(rows);
});

app.post('/api/licenses/:id/ip', auth, async (req, res) => {
  const { ip, label } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'IP obrigatório.' });
  const result = await pool.query(`INSERT INTO authorized_ips (license_id, ip_address, label) SELECT id, $1::inet, $2 FROM licenses WHERE id=$3 AND user_id=$4 AND status='active' ON CONFLICT DO NOTHING RETURNING id, ip_address, label`, [ip.trim(), label || null, req.params.id, req.user.sub]);
  if (!result.rowCount) return res.status(404).json({ error: 'Licença não encontrada ou IP já autorizado.' });
  res.status(201).json(result.rows[0]);
});

app.post('/api/license/verify', async (req, res) => {
  const { key, product, ip } = req.body || {};
  if (!key || !product || !ip) return res.status(400).json({ valid: false, ip_authorized: false });
  const result = await pool.query(`SELECT l.id, l.license_key_hash, l.status, p.slug FROM licenses l JOIN products p ON p.id=l.product_id WHERE l.license_key_fingerprint=$1 AND p.slug=$2`, [fingerprint(key.trim()), product.trim()]);
  const license = result.rows[0];
  if (!license || license.status !== 'active' || !(await bcrypt.compare(key.trim(), license.license_key_hash))) return res.status(403).json({ valid: false, ip_authorized: false });
  const authorized = await pool.query('SELECT id FROM authorized_ips WHERE license_id=$1 AND ip_address=$2::inet', [license.id, ip.trim()]);
  if (!authorized.rowCount) return res.status(403).json({ valid: true, ip_authorized: false });
  await pool.query('UPDATE authorized_ips SET last_seen_at=NOW() WHERE id=$1', [authorized.rows[0].id]);
  res.json({ valid: true, ip_authorized: true });
});

requiredEnv();
app.listen(port, '0.0.0.0', () => console.log(`Vortex API ouvindo na porta ${port}`));
