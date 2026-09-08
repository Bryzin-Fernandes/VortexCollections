CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  download_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('fixed','percent')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  mercado_pago_id VARCHAR(120) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  amount_cents INTEGER NOT NULL,
  original_amount_cents INTEGER,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  coupon_id BIGINT REFERENCES coupons(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS licenses (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  license_key_fingerprint CHAR(64) NOT NULL UNIQUE,
  license_key_hash VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase','subscription','admin')),
  subscription_id BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS authorized_ips (
  id BIGSERIAL PRIMARY KEY,
  license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  label VARCHAR(120),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (license_id, ip_address)
);

CREATE TABLE IF NOT EXISTS support_agents (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  subject VARCHAR(150) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS support_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS subscription_plans (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  plan_id BIGINT NOT NULL REFERENCES subscription_plans(id),
  mercado_pago_id VARCHAR(120) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO products (slug, name, price_cents) VALUES
  ('vortex-kitpvp', 'VortexKitPvP', 12500),
  ('vortex-feast', 'VortexFeast', 2000),
  ('vortex-thepit', 'VortexThePIT', 12500),
  ('vortex-skywars', 'VortexSkyWars', 0)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO subscription_plans (slug,name,price_cents,features) VALUES
 ('beta','Plano Beta',0,'["2 plugins: VortexKitPvP e VortexFeast"]'),
 ('premium','Plano Premium',0,'["Todos os plugins ativos"]')
ON CONFLICT (slug) DO NOTHING;
