require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const vault = require('./license-vault');

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
    INSERT INTO licenses (order_id, user_id, product_id, license_key_fingerprint, license_key_hash, key_encrypted)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id
  `, [order.order_id, order.user_id, order.product_id, fingerprint(key), keyHash, vault.encrypt(key, order.order_id)]);
  return result.rowCount ? key : null;
}

require('./customer-api')({ app, pool, auth, bcrypt, vault, fingerprint, createLicenseKey, mercadoPago, provisionLicense });

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


async function start() {
  requiredEnv();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  await pool.query('ALTER TABLE licenses ADD COLUMN IF NOT EXISTS key_encrypted TEXT');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT UNIQUE');
  app.listen(port, '0.0.0.0', () => console.log(`Vortex API ouvindo na porta ${port}`));
}

start().catch(error => {
  console.error('Não foi possível iniciar a API ou preparar o banco:', error);
  process.exit(1);
});
