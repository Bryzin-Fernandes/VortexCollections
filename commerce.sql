ALTER TABLE users ADD COLUMN IF NOT EXISTS minecraft_nick VARCHAR(16);
ALTER TABLE products ADD COLUMN IF NOT EXISTS minecraft_versions TEXT NOT NULL DEFAULT '1.21';
INSERT INTO products (slug,name,price_cents,minecraft_versions)
VALUES ('vortex-bedwars','VortexBedWars',15000,'1.21')
ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,price_cents=EXCLUDED.price_cents,minecraft_versions=EXCLUDED.minecraft_versions;
UPDATE products SET minecraft_versions='1.21' WHERE slug IN ('vortex-kitpvp','vortex-feast','vortex-thepit','vortex-skywars','vortex-bedwars');

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  original_amount_cents INTEGER NOT NULL CHECK(original_amount_cents>0),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  discount_cents INTEGER NOT NULL DEFAULT 0,
  coupon_id BIGINT REFERENCES coupons(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','cancelled')),
  mercado_pago_id TEXT UNIQUE,
  payment_id TEXT UNIQUE,
  checkout_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,request_id)
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_id UUID REFERENCES checkout_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_checkout_idx ON orders(checkout_id);
CREATE INDEX IF NOT EXISTS checkout_coupon_idx ON checkout_sessions(coupon_id,status,expires_at);
