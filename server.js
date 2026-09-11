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
const installAdminSupport = require('./admin-support-api');

const app = express();
const port = Number(process.env.PORT || 10000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(v => v.trim()) : true }));
app.use(express.json({ limit: '100kb' }));
app.use('/api', (_req,res,next) => { res.set('Cache-Control','no-store'); next(); });

function requiredEnv() {
  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'LICENSE_SECRET', 'MP_ACCESS_TOKEN']) {
    if (!process.env[name]) throw new Error(`Variável ausente: ${name}`);
  }
}

function issueToken(user, remember = false) {
  return jwt.sign({ sub: String(user.id), role: user.role }, process.env.JWT_SECRET, { expiresIn: remember ? '7d' : '12h' });
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
    signal: options.signal || AbortSignal.timeout(20000),
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

const { confirmCartPayment } = require('./commerce-api')({ app, pool, auth, mercadoPago, provisionLicense });
require('./customer-api')({ app, pool, auth, bcrypt, vault, fingerprint, createLicenseKey, mercadoPago, provisionLicense, confirmCartPayment });
require('./auth-api')({ app, pool, auth, bcrypt, issueToken });
installAdminSupport({ app, pool, auth, mercadoPago, createLicenseKey, bcrypt, vault, fingerprint });

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'vortex-api' }); }
  catch (_) { res.status(503).json({ ok: false }); }
});

async function start() {
  requiredEnv();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  await pool.query(fs.readFileSync(path.join(__dirname, 'commerce.sql'), 'utf8'));
  await pool.query('ALTER TABLE licenses ADD COLUMN IF NOT EXISTS key_encrypted TEXT');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT UNIQUE');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount_cents INTEGER');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id BIGINT');
  await pool.query("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'purchase'");
  await pool.query('ALTER TABLE licenses ADD COLUMN IF NOT EXISTS subscription_id BIGINT');
  await pool.query('CREATE TABLE IF NOT EXISTS password_reset_tokens (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash CHAR(64) NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const betaPrice = optionalPlanPrice('PLAN_BETA_PRICE_CENTS');
  const premiumPrice = optionalPlanPrice('PLAN_PREMIUM_PRICE_CENTS');
  if (betaPrice !== null) await pool.query("UPDATE subscription_plans SET price_cents=$1 WHERE slug='beta'", [betaPrice]);
  if (premiumPrice !== null) await pool.query("UPDATE subscription_plans SET price_cents=$1 WHERE slug='premium'", [premiumPrice]);
  app.listen(port, '0.0.0.0', () => console.log(`Vortex API ouvindo na porta ${port}`));
}

function optionalPlanPrice(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw || raw === '0') return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    console.warn(`${name} inválida; use somente centavos, por exemplo 2990. Plano permanecerá desativado até receber um valor válido.`);
    return null;
  }
  return value;
}

start().catch(error => {
  console.error('Não foi possível iniciar a API ou preparar o banco:', error);
  process.exit(1);
});
