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
  app.get('/api/admin/users', ...admin, wrap(async (_req, res) => res.json((await pool.query("SELECT u.id,u.name,u.email,u.role,u.created_at,COUNT(DISTINCT l.id)::int AS licenses FROM users u LEFT JOIN licenses l ON l.user_id=u.id GROUP BY u.id ORDER BY u.id DESC LIMIT 500")).rows)));
  app.patch('/api/admin/users/:id', ...admin, wrap(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'ID de usuário inválido.' });
    const name = String(req.body?.name || '').trim().slice(0, 120), email = String(req.body?.email || '').trim().toLowerCase().slice(0, 190), role = req.body?.role === 'admin' ? 'admin' : 'customer';
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Nome e e-mail válidos são obrigatórios.' });
    if (String(req.params.id) === String(process.env.ADMIN_USER_ID) && role !== 'admin') return res.status(400).json({ error: 'O administrador principal não pode perder a permissão admin.' });
    try { const row = (await pool.query('UPDATE users SET name=$1,email=$2,role=$3 WHERE id=$4 RETURNING id,name,email,role', [name, email, role, req.params.id])).rows[0]; if (!row) return res.status(404).json({ error: 'Usuário não encontrado.' }); res.json(row); }
    catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' }); throw error; }
  }));
  app.delete('/api/admin/users/:id', ...admin, wrap(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'ID de usuário inválido.' });
    if (String(req.params.id) === String(process.env.ADMIN_USER_ID)) return res.status(400).json({ error: 'O administrador principal não pode ser removido.' });
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query('DELETE FROM support_messages WHERE author_id=$1', [req.params.id]); await client.query('DELETE FROM support_tickets WHERE user_id=$1', [req.params.id]); await client.query('DELETE FROM support_agents WHERE user_id=$1', [req.params.id]); await client.query('DELETE FROM authorized_ips WHERE license_id IN (SELECT id FROM licenses WHERE user_id=$1)', [req.params.id]); await client.query('DELETE FROM licenses WHERE user_id=$1', [req.params.id]); await client.query('DELETE FROM subscriptions WHERE user_id=$1', [req.params.id]); await client.query('DELETE FROM orders WHERE user_id=$1', [req.params.id]); const result = await client.query('DELETE FROM users WHERE id=$1', [req.params.id]); if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Usuário não encontrado.' }); } await client.query('COMMIT'); res.json({ ok: true }); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.get('/api/admin/licenses', ...admin, wrap(async (_req, res) => res.json((await pool.query('SELECT l.id,l.status,l.created_at,u.id user_id,u.name,u.email,p.name product FROM licenses l JOIN users u ON u.id=l.user_id JOIN products p ON p.id=l.product_id ORDER BY l.id DESC LIMIT 200')).rows)));
  app.post('/api/admin/licenses', ...admin, wrap(async (req, res) => {
    const userId = String(req.body?.user_id || ''), slug = String(req.body?.product || '').trim();
    if (!/^\d+$/.test(userId) || !/^[a-z0-9-]{2,80}$/.test(slug)) return res.status(400).json({ error: 'Informe um ID de cliente e um produto válidos.' });
    const user = (await pool.query('SELECT id FROM users WHERE id=$1', [userId])).rows[0];
    const product = (await pool.query('SELECT id,slug,price_cents FROM products WHERE slug=$1 AND active=TRUE', [slug])).rows[0];
    if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
    if (!product) return res.status(404).json({ error: 'Produto não encontrado ou inativo.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = (await client.query("INSERT INTO orders (user_id,product_id,amount_cents,original_amount_cents,status) VALUES ($1,$2,$3,$3,'approved') RETURNING id", [user.id, product.id, product.price_cents])).rows[0];
      const key = createLicenseKey(product.slug);
      const license = (await client.query("INSERT INTO licenses (order_id,user_id,product_id,license_key_fingerprint,license_key_hash,key_encrypted,source,status) VALUES ($1,$2,$3,$4,$5,$6,'admin','active') RETURNING id", [order.id, user.id, product.id, fingerprint(key), await bcrypt.hash(key, 12), vault.encrypt(key, order.id)])).rows[0];
      await client.query('COMMIT'); res.status(201).json({ ok: true, license_id: license.id });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.post('/api/admin/licenses/:id/revoke', ...admin, wrap(async (req, res) => { await pool.query("UPDATE licenses SET status='revoked' WHERE id=$1", [req.params.id]); res.json({ok:true}); }));
  app.delete('/api/admin/licenses/:id', ...admin, wrap(async (req, res) => { if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Licença inválida.' }); const client = await pool.connect(); try { await client.query('BEGIN'); const row = (await client.query('SELECT order_id FROM licenses WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0]; if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Licença não encontrada.' }); } await client.query('DELETE FROM authorized_ips WHERE license_id=$1', [req.params.id]); await client.query('DELETE FROM licenses WHERE id=$1', [req.params.id]); await client.query('DELETE FROM orders WHERE id=$1', [row.order_id]); await client.query('COMMIT'); res.json({ ok: true }); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }));
  app.post('/api/admin/users/:id/password', ...admin, wrap(async (req, res) => {
    const password = String(req.body?.password || '');
    if (!/^\d+$/.test(req.params.id) || password.length < 8 || password.length > 200) return res.status(400).json({ error: 'A senha deve ter entre 8 e 200 caracteres.' });
    const result = await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(password, 12), req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json({ ok: true });
  }));
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
