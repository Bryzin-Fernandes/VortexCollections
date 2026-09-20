const LEVELS = Object.freeze([
  { name: 'Visitante', threshold_cents: 0, tone: 'slate' },
  { name: 'Eupátrida', threshold_cents: 5000, tone: 'blue' },
  { name: 'Dionísio', threshold_cents: 15000, tone: 'violet' },
  { name: 'Hércules', threshold_cents: 30000, tone: 'amber' },
  { name: 'Titã', threshold_cents: 60000, tone: 'rose' },
  { name: 'Olimpo', threshold_cents: 100000, tone: 'gold' }
]);

function progressFor(spentValue) {
  const spentCents = Math.max(0, Number(spentValue) || 0);
  let currentIndex = 0;
  LEVELS.forEach((level, index) => {
    if (spentCents >= level.threshold_cents) currentIndex = index;
  });
  const current = LEVELS[currentIndex];
  const next = LEVELS[currentIndex + 1] || null;
  const span = next ? next.threshold_cents - current.threshold_cents : 0;
  const progressPercent = next
    ? Math.min(100, Math.max(0, Math.round(((spentCents - current.threshold_cents) / span) * 1000) / 10))
    : 100;

  return {
    name: current.name,
    tone: current.tone,
    threshold_cents: current.threshold_cents,
    next: next ? { name: next.name, tone: next.tone, threshold_cents: next.threshold_cents } : null,
    to_next_cents: next ? Math.max(0, next.threshold_cents - spentCents) : 0,
    progress_percent: progressPercent
  };
}

async function customerTotals(pool, userId) {
  const row = (await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status='approved' THEN amount_cents ELSE 0 END), 0)::bigint AS spent_cents,
      COUNT(DISTINCT CASE WHEN status='approved' THEN id END)::int AS purchase_count,
      COUNT(DISTINCT CASE WHEN status='approved' THEN product_id END)::int AS plugin_count
    FROM orders
    WHERE user_id=$1
  `, [userId])).rows[0] || {};
  return {
    spent_cents: Number(row.spent_cents || 0),
    purchase_count: Number(row.purchase_count || 0),
    plugin_count: Number(row.plugin_count || 0)
  };
}

async function publicRankFor(pool, userId) {
  const row = (await pool.query(`
    WITH totals AS (
      SELECT u.id,
        COALESCE(SUM(CASE WHEN o.status='approved' THEN o.amount_cents ELSE 0 END), 0)::bigint AS spent_cents
      FROM users u
      LEFT JOIN orders o ON o.user_id=u.id
      WHERE u.profile_public=TRUE
      GROUP BY u.id
    ), ranked AS (
      SELECT id, DENSE_RANK() OVER (ORDER BY spent_cents DESC)::int AS ranking
      FROM totals
    )
    SELECT ranking FROM ranked WHERE id=$1
  `, [userId])).rows[0];
  return row ? Number(row.ranking) : null;
}

async function customerStats(pool, userId) {
  const totals = await customerTotals(pool, userId);
  return {
    ...totals,
    ranking: await publicRankFor(pool, userId),
    level: progressFor(totals.spent_cents)
  };
}

async function publicRanking(pool, limit = 10) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
  const rows = (await pool.query(`
    WITH totals AS (
      SELECT u.id,u.name,u.minecraft_nick,u.avatar_mode,u.avatar_url,u.banner_url,
        COALESCE(SUM(CASE WHEN o.status='approved' THEN o.amount_cents ELSE 0 END), 0)::bigint AS spent_cents,
        COUNT(DISTINCT CASE WHEN o.status='approved' THEN o.id END)::int AS purchase_count,
        COUNT(DISTINCT CASE WHEN o.status='approved' THEN o.product_id END)::int AS plugin_count
      FROM users u
      LEFT JOIN orders o ON o.user_id=u.id
      WHERE u.profile_public=TRUE
      GROUP BY u.id,u.name,u.minecraft_nick,u.avatar_mode,u.avatar_url,u.banner_url
    ), ranked AS (
      SELECT totals.*, DENSE_RANK() OVER (ORDER BY spent_cents DESC)::int AS ranking
      FROM totals
    )
    SELECT * FROM ranked ORDER BY spent_cents DESC,id ASC LIMIT $1
  `, [safeLimit])).rows;
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    minecraft_nick: row.minecraft_nick,
    avatar_mode: row.avatar_mode || 'minecraft',
    avatar_url: row.avatar_url,
    banner_url: row.banner_url,
    spent_cents: Number(row.spent_cents || 0),
    purchase_count: Number(row.purchase_count || 0),
    plugin_count: Number(row.plugin_count || 0),
    ranking: Number(row.ranking),
    level: progressFor(row.spent_cents)
  }));
}

async function publicProfile(pool, userId) {
  const user = (await pool.query(`
    SELECT id,name,minecraft_nick,avatar_mode,avatar_url,banner_url,created_at
    FROM users WHERE id=$1 AND profile_public=TRUE
  `, [userId])).rows[0];
  if (!user) return null;

  const stats = await customerStats(pool, userId);
  const products = (await pool.query(`
    SELECT slug,name,minecraft_versions,amount_cents,created_at
    FROM (
      SELECT DISTINCT ON (p.id) p.slug,p.name,p.minecraft_versions,o.amount_cents,o.created_at
      FROM orders o JOIN products p ON p.id=o.product_id
      WHERE o.user_id=$1 AND o.status='approved'
      ORDER BY p.id,o.created_at DESC
    ) purchased
    ORDER BY created_at DESC
  `, [userId])).rows.map(row => ({
    slug: row.slug,
    name: row.name,
    minecraft_versions: row.minecraft_versions || '1.8–1.21',
    amount_cents: Number(row.amount_cents || 0),
    purchased_at: row.created_at
  }));

  return {
    ...user,
    ...stats,
    products
  };
}

module.exports = { LEVELS, progressFor, customerStats, publicRanking, publicProfile };
