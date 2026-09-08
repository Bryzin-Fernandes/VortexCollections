const crypto = require('crypto');

function install({ app, pool, auth, mercadoPago, createLicenseKey, bcrypt, vault, fingerprint }) {
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(error => {
    console.error('Admin/suporte:', error.code || error.name);
    if (!res.headersSent) res.status(500).json({ error: 'Não foi possível concluir a operação.' });
  });
  const admin = [auth, wrap(async (req, res, next) => {
    if (req.user.role !== 'admin' || !process.env.ADMIN_USER_ID || String(req.user.sub) !== String(process.env.ADMIN_USER_ID)) return res.status(403).json({ error: 'Acesso restrito ao administrador principal.' });
    next();
  })];
  const staff = [auth, wrap(async (req, res, next) => {
    if (req.user.role === 'admin' && process.env.ADMIN_USER_ID && String(req.user.sub) === String(process.env.ADMIN_USER_ID)) return next();
    const row = (await pool.query('SELECT 1 FROM support_agents WHERE user_id=$1 AND active=TRUE', [req.user.sub])).rows[0];
    if (!row) return res.status(403).json({ error: 'Acesso restrito à equipe de suporte.' });
    next();
  })];
  const activePlan = async user => (await pool.query(`SELECT s.*,p.slug,p.name,p.features FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.user_id=$1 AND s.status='active' AND s.current_period_end>NOW() ORDER BY s.current_period_end DESC LIMIT 1`, [user])).rows[0];
  const entitlements = slug => slug === 'beta' ? ['vortex-kitpvp', 'vortex-feast'] : ['vortex-kitpvp', 'vortex-feast', 'vortex-thepit', 'vortex-skywars'];
  async function activateSubscription(sub, plan) {
    for (const slug of entitlements(plan.slug)) {
      const product = (await pool.query('SELECT id,slug FROM products WHERE slug=$1 AND active=TRUE', [slug])).rows[0];
      if (!product) continue;
      const exists = (await pool.query("SELECT id FROM licenses WHERE subscription_id=$1 AND product_id=$2 AND status='active'", [sub.id, product.id])).rows[0];
      if (exists) continue;
      const order = (await pool.query("INSERT INTO orders (user_id,product_id,amount_cents,status) VALUES ($1,$2,0,'approved') RETURNING id", [sub.user_id, product.id])).rows[0];
      const key = createLicenseKey(product.slug);
      await pool.query("INSERT INTO licenses (order_id,user_id,product_id,license_key_fingerprint,license_key_hash,key_encrypted,source,subscription_id) VALUES ($1,$2,$3,$4,$5,$6,'subscription',$7)", [order.id, sub.user_id, product.id, fingerprint(key), await bcrypt.hash(key, 12), vault.encrypt(key, order.id), sub.id]);
    }
  }

  app.get('/api/plans', wrap(async (_req, res) => res.json((await pool.query('SELECT slug,name,price_cents,features FROM subscription_plans WHERE active=TRUE ORDER BY price_cents')).rows)));
  app.get('/api/me/subscription', auth, wrap(async (req, res) => res.json((await activePlan(req.user.sub)) || null)));
  app.post('/api/plans/:slug/subscribe', auth, wrap(async (req, res) => {
    const plan = (await pool.query('SELECT * FROM subscription_plans WHERE slug=$1 AND active=TRUE', [req.params.slug])).rows[0];
    const user = (await pool.query('SELECT id,email FROM users WHERE id=$1', [req.user.sub])).rows[0];
    if (!plan || !user || Number(plan.price_cents) <= 0) return res.status(400).json({ error: 'Plano ainda não configurado para assinatura.' });
    if (await activePlan(req.user.sub)) return res.status(409).json({ error: 'Você já possui uma assinatura ativa.' });
    const subscription = (await pool.query('INSERT INTO subscriptions (user_id,plan_id,status,current_period_end) VALUES ($1,$2,\'pending\',NOW()) RETURNING id', [user.id, plan.id])).rows[0];
    try {
      const mp = await mercadoPago('/preapproval', { method: 'POST', body: JSON.stringify({ reason: plan.name, payer_email: user.email, external_reference: `subscription:${subscription.id}`, auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Number(plan.price_cents) / 100, currency_id: 'BRL' }, back_url: `${process.env.PUBLIC_URL}/#cliente`, status: 'pending' }) });
      await pool.query('UPDATE subscriptions SET mercado_pago_id=$1 WHERE id=$2', [mp.id, subscription.id]);
      res.status(201).json({ checkout_url: mp.init_point || mp.sandbox_init_point, subscription_id: subscription.id });
    } catch (error) { await pool.query("UPDATE subscriptions SET status='cancelled' WHERE id=$1", [subscription.id]); throw error; }
  }));
  app.post('/api/coupons/validate', auth, wrap(async (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const row = (await pool.query("SELECT code,discount_type,discount_value FROM coupons WHERE code=$1 AND active=TRUE AND (expires_at IS NULL OR expires_at>NOW()) AND (max_uses IS NULL OR used_count<max_uses)", [code])).rows[0];
    if (!row) return res.status(404).json({ error: 'Cupom inválido, expirado ou esgotado.' });
    res.json(row);
  }));

  app.get('/api/support/tickets', auth, wrap(async (req, res) => {
    const isStaff = req.user.role === 'admin' && process.env.ADMIN_USER_ID && String(req.user.sub) === String(process.env.ADMIN_USER_ID) || (await pool.query('SELECT 1 FROM support_agents WHERE user_id=$1 AND active=TRUE', [req.user.sub])).rowCount;
    const query = isStaff ? 'SELECT t.*,u.name AS customer_name,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC' : 'SELECT t.*,u.name AS customer_name,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.user_id=$1 ORDER BY t.updated_at DESC';
    res.json((await pool.query(query, isStaff ? [] : [req.user.sub])).rows);
  }));
  app.get('/api/support/tickets/:id', auth, wrap(async (req, res) => {
    const ticket = (await pool.query('SELECT t.*,u.name AS customer_name,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1', [req.params.id])).rows[0];
    if (!ticket) return res.sendStatus(404);
    const isStaff = req.user.role === 'admin' && process.env.ADMIN_USER_ID && String(req.user.sub) === String(process.env.ADMIN_USER_ID) || (await pool.query('SELECT 1 FROM support_agents WHERE user_id=$1 AND active=TRUE', [req.user.sub])).rowCount;
    if (!isStaff && String(ticket.user_id) !== String(req.user.sub)) return res.sendStatus(404);
    res.json({ ticket, messages: (await pool.query('SELECT m.*,u.name AS author_name FROM support_messages m JOIN users u ON u.id=m.author_id WHERE m.ticket_id=$1 ORDER BY m.created_at', [req.params.id])).rows });
  }));
  app.post('/api/support/tickets', auth, wrap(async (req, res) => {
    const subject = String(req.body.subject || '').trim().slice(0,150), message = String(req.body.message || '').trim().slice(0,5000);
    if (!subject || !message) return res.status(400).json({ error: 'Informe o assunto e a mensagem.' });
    const ticket = (await pool.query('INSERT INTO support_tickets (user_id,subject,status) VALUES ($1,$2,\'open\') RETURNING id', [req.user.sub, subject])).rows[0];
    await pool.query('INSERT INTO support_messages (ticket_id,author_id,body) VALUES ($1,$2,$3)', [ticket.id, req.user.sub, message]);
    res.status(201).json(ticket);
  }));
  app.post('/api/support/tickets/:id/messages', auth, wrap(async (req, res) => {
    const ticket = (await pool.query('SELECT * FROM support_tickets WHERE id=$1', [req.params.id])).rows[0];
    if (!ticket) return res.sendStatus(404);
    const isStaff = req.user.role === 'admin' && process.env.ADMIN_USER_ID && String(req.user.sub) === String(process.env.ADMIN_USER_ID) || (await pool.query('SELECT 1 FROM support_agents WHERE user_id=$1 AND active=TRUE', [req.user.sub])).rowCount;
    if (!isStaff && String(ticket.user_id) !== String(req.user.sub)) return res.sendStatus(404);
    const body = String(req.body.body || '').trim().slice(0,5000); if (!body) return res.status(400).json({ error: 'Mensagem vazia.' });
    await pool.query('INSERT INTO support_messages (ticket_id,author_id,body) VALUES ($1,$2,$3)', [ticket.id, req.user.sub, body]);
    await pool.query("UPDATE support_tickets SET status=$1,updated_at=NOW() WHERE id=$2", [isStaff ? 'waiting_customer' : 'open', ticket.id]);
    res.status(201).json({ ok: true });
  }));
  app.post('/api/support/tickets/:id/close', auth, wrap(async (req, res) => { const t=(await pool.query('SELECT user_id FROM support_tickets WHERE id=$1',[req.params.id])).rows[0]; if(!t||String(t.user_id)!==String(req.user.sub)) return res.sendStatus(404); await pool.query("UPDATE support_tickets SET status='closed',updated_at=NOW() WHERE id=$1",[req.params.id]); res.json({ok:true}); }));

  app.get('/api/admin/overview', ...admin, wrap(async (_req, res) => res.json({ users: (await pool.query('SELECT COUNT(*)::int count FROM users')).rows[0].count, licenses: (await pool.query("SELECT COUNT(*)::int count FROM licenses WHERE status='active'")).rows[0].count, tickets: (await pool.query("SELECT COUNT(*)::int count FROM support_tickets WHERE status<>'closed'")).rows[0].count, coupons: (await pool.query('SELECT COUNT(*)::int count FROM coupons WHERE active=TRUE')).rows[0].count })));
  app.get('/api/admin/licenses', ...admin, wrap(async (_req, res) => res.json((await pool.query('SELECT l.id,l.status,l.created_at,u.id user_id,u.name,u.email,p.name product FROM licenses l JOIN users u ON u.id=l.user_id JOIN products p ON p.id=l.product_id ORDER BY l.id DESC LIMIT 200')).rows)));
  app.post('/api/admin/licenses', ...admin, wrap(async (req, res) => {
    const { user_id, product } = req.body || {}; const row = (await pool.query('SELECT u.id user_id,p.id product_id,p.slug FROM users u JOIN products p ON p.slug=$2 WHERE u.id=$1 AND p.active=TRUE', [user_id, product])).rows[0]; if (!row) return res.status(400).json({ error: 'Cliente ou produto inválido.' });
    const order=(await pool.query("INSERT INTO orders (user_id,product_id,amount_cents,status) SELECT $1,id,price_cents,'approved' FROM products WHERE id=$2 RETURNING id,product_id,user_id",[row.user_id,row.product_id])).rows[0]; const key=createLicenseKey(row.slug); await pool.query('INSERT INTO licenses (order_id,user_id,product_id,license_key_fingerprint,license_key_hash,key_encrypted) VALUES ($1,$2,$3,$4,$5,$6)',[order.id,row.user_id,row.product_id,fingerprint(key),await bcrypt.hash(key,12),vault.encrypt(key,order.id)]); res.status(201).json({ ok:true });
  }));
  app.post('/api/admin/licenses/:id/revoke', ...admin, wrap(async (req, res) => { await pool.query("UPDATE licenses SET status='revoked' WHERE id=$1", [req.params.id]); res.json({ok:true}); }));
  app.get('/api/admin/coupons', ...admin, wrap(async (_req, res) => res.json((await pool.query('SELECT * FROM coupons ORDER BY created_at DESC')).rows)));
  app.post('/api/admin/coupons', ...admin, wrap(async (req, res) => { const code=String(req.body.code||'').trim().toUpperCase(); const type=req.body.discount_type==='percent'?'percent':'fixed'; const value=Number(req.body.discount_value); if(!/^[A-Z0-9_-]{3,40}$/.test(code)||!Number.isInteger(value)||value<=0||(type==='percent'&&value>100)) return res.status(400).json({error:'Dados do cupom inválidos.'}); const row=(await pool.query('INSERT INTO coupons (code,discount_type,discount_value,max_uses,expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',[code,type,value,req.body.max_uses||null,req.body.expires_at||null])).rows[0]; res.status(201).json(row); }));
  app.delete('/api/admin/coupons/:code', ...admin, wrap(async (req,res)=>{await pool.query('UPDATE coupons SET active=FALSE WHERE code=$1',[req.params.code.toUpperCase()]);res.json({ok:true});}));
  app.get('/api/admin/support-agents', ...admin, wrap(async (_req,res)=>res.json((await pool.query('SELECT a.*,u.name,u.email FROM support_agents a JOIN users u ON u.id=a.user_id ORDER BY a.created_at')).rows)));
  app.post('/api/admin/support-agents', ...admin, wrap(async (req,res)=>{const user=(await pool.query('SELECT id FROM users WHERE email=LOWER($1)',[String(req.body.email||'')])).rows[0];if(!user)return res.status(404).json({error:'Usuário não encontrado.'});await pool.query('INSERT INTO support_agents(user_id,active) VALUES($1,TRUE) ON CONFLICT(user_id) DO UPDATE SET active=TRUE',[user.id]);res.json({ok:true});}));
  app.delete('/api/admin/support-agents/:id', ...admin, wrap(async(req,res)=>{await pool.query('UPDATE support_agents SET active=FALSE WHERE user_id=$1',[req.params.id]);res.json({ok:true});}));

  app.post('/api/mercadopago/subscription-webhook', wrap(async (req,res)=>{const id=String(req.body?.data?.id||req.query['data.id']||'');if(!id)return res.sendStatus(200);const mp=await mercadoPago('/preapproval/'+encodeURIComponent(id));const sub=(await pool.query('SELECT * FROM subscriptions WHERE mercado_pago_id=$1',[id])).rows[0];if(sub){const status=mp.status==='authorized'?'active':mp.status==='paused'?'paused':'cancelled';const end=mp.next_payment_date||mp.date_created;await pool.query('UPDATE subscriptions SET status=$1,current_period_end=$2,updated_at=NOW() WHERE id=$3',[status,end,sub.id]);if(status==='active'){const plan=(await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[sub.plan_id])).rows[0];if(plan) await activateSubscription(sub,plan);}else await pool.query("UPDATE licenses SET status='suspended' WHERE subscription_id=$1",[sub.id]);}res.sendStatus(200);}));
  const expire = async () => { await pool.query("UPDATE subscriptions SET status='expired',updated_at=NOW() WHERE status='active' AND current_period_end<=NOW()"); await pool.query("UPDATE licenses SET status='suspended' WHERE source='subscription' AND status='active' AND subscription_id IN (SELECT id FROM subscriptions WHERE status<>'active' OR current_period_end<=NOW())"); };
  setInterval(() => expire().catch(e=>console.error('Expiração:',e.code||e.name)), 15*60*1000);
}
module.exports = install;
