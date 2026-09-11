const crypto = require('crypto');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status=400) => { throw Object.assign(Error(message), {status}); };
function normalizeItems(body) {
  const items = body.items || (body.product ? [body.product] : []);
  if(!Array.isArray(items) || items.length<1 || items.length>20) fail('Adicione de 1 a 20 plugins ao carrinho.');
  if(items.some(s => typeof s!=='string' || !/^[a-z0-9-]{2,80}$/.test(s))) fail('Produto inválido no carrinho.');
  if(new Set(items).size!==items.length) fail('Cada produto pode aparecer uma vez por carrinho.');
  return [...items].sort();
}
function calculate(products, coupon) {
  const original = products.reduce((n,p) => n+Number(p.price_cents),0);
  let discount = coupon ? (coupon.discount_type==='percent' ? Math.floor(original*Number(coupon.discount_value)/100) : Number(coupon.discount_value)) : 0;
  discount = Math.min(original,Math.max(0,discount));
  let allocated=0, running=0;
  const items=products.map((p,index) => {
    running+=Number(p.price_cents);
    const cumulative=index===products.length-1 ? discount : Math.floor(discount*running/original);
    const reduction=cumulative-allocated;
    allocated+=reduction;
    return {slug:p.slug,name:p.name,product_id:p.id,original_amount_cents:Number(p.price_cents),discount_cents:reduction,amount_cents:Number(p.price_cents)-reduction};
  });
  return {items, original_amount_cents:original,discount_cents:discount,amount_cents:original-discount,coupon:coupon?.code || null};
}
function paymentMatches(payment, session) {
  return payment.external_reference===`cart:${session.id}` && payment.currency_id==='BRL'
    && Number(session.amount_cents)>0 && Math.round(Number(payment.transaction_amount)*100)===Number(session.amount_cents)
    && Number(payment.transaction_amount_refunded || 0)===0;
}
function install({app,pool,auth,mercadoPago,provisionLicense}) {
  const wrap=fn => (req,res) => Promise.resolve().then(()=>fn(req,res)).catch(e=>{
    console.error('Commerce:',e.code || e.status || e.name);
    if(!res.headersSent) res.status(e.status || 500).json({error:e.status?e.message:'Não foi possível preparar a compra. Tente novamente.'});
  });
  async function quote(client, body, reserve=false) {
    const slugs=normalizeItems(body);
    const products=(await client.query('SELECT id,slug,name,price_cents FROM products WHERE slug=ANY($1::text[]) AND active=TRUE ORDER BY slug',[slugs])).rows;
    if(products.length!==slugs.length || products.some(p=>Number(p.price_cents)<=0)) fail('Um produto está indisponível ou com preço sob consulta. Atualize o carrinho.');
    const code=String(body.coupon || '').trim().toUpperCase();
    if(code.length>40) fail('Cupom inválido.');
    let coupon;
    if(code) {
      coupon=(await client.query("SELECT * FROM coupons WHERE code=$1 AND active=TRUE AND (expires_at IS NULL OR expires_at>NOW())"+(reserve?' FOR UPDATE':''),[code])).rows[0];
      if(!coupon) fail('Cupom inválido ou expirado.');
      const reserved=Number((await client.query("SELECT COUNT(*)::int AS count FROM checkout_sessions WHERE coupon_id=$1 AND status='pending' AND expires_at>NOW()",[coupon.id])).rows[0].count);
      if(coupon.max_uses!==null && Number(coupon.used_count)+reserved>=Number(coupon.max_uses)) fail('Este cupom atingiu o limite de usos ou está reservado em outra compra.');
    }
    return {...calculate(products,coupon),coupon_id:coupon?.id || null};
  }
  app.get('/api/products',wrap(async (_req,res)=>res.json((await pool.query('SELECT slug,name,price_cents,minecraft_versions FROM products WHERE active=TRUE ORDER BY id')).rows)));
  app.post('/api/cart/quote',auth,wrap(async(req,res)=>res.json(await quote(pool,req.body || {}))));
  app.post('/api/checkout',auth,wrap(async(req,res)=>{
    const slugs=normalizeItems(req.body || {});
    const requestId=req.body.request_id || crypto.randomUUID();
    if(!uuid.test(requestId)) fail('Identificador de compra inválido.');
    const hash=crypto.createHash('sha256').update(JSON.stringify([slugs,String(req.body.coupon || '').trim().toUpperCase()])).digest('hex');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize retries for this buyer before creating any Mercado Pago preference.
      const account=(await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0];
      if(!account) fail('Conta não encontrada.',401);
      const existing=(await client.query('SELECT * FROM checkout_sessions WHERE user_id=$1 AND request_id=$2',[req.user.sub,requestId])).rows[0];
      if(existing) {
        if(existing.request_hash!==hash) fail('O carrinho mudou. Inicie uma nova compra.',409);
        if(existing.status==='cancelled' || (existing.status==='pending' && new Date(existing.expires_at)<=new Date())) fail('Este checkout expirou. Gere um novo pagamento.',409);
        await client.query('COMMIT');
        return res.json({checkout_id:existing.id,checkout_url:existing.checkout_url,approved:existing.status==='approved'});
      }
      const pending=Number((await client.query("SELECT COUNT(*)::int AS count FROM checkout_sessions WHERE user_id=$1 AND status='pending' AND expires_at>NOW()",[req.user.sub])).rows[0].count);
      if(pending>=10) fail('Você já possui compras pendentes. Aguarde a expiração ou conclua uma delas.',429);
      const summary=await quote(client,req.body,true);
      const id=crypto.randomUUID();
      await client.query('INSERT INTO checkout_sessions (id,user_id,request_id,request_hash,original_amount_cents,amount_cents,discount_cents,coupon_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,req.user.sub,requestId,hash,summary.original_amount_cents,summary.amount_cents,summary.discount_cents,summary.coupon_id]);
      const orders=[];
      for(const item of summary.items) {
        const order=(await client.query('INSERT INTO orders(user_id,product_id,amount_cents,original_amount_cents,discount_cents,coupon_id,checkout_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[req.user.sub,item.product_id,item.amount_cents,item.original_amount_cents,item.discount_cents,summary.coupon_id,id])).rows[0];
        orders.push({order_id:order.id,user_id:req.user.sub,product_id:item.product_id,product_slug:item.slug});
      }
      let checkoutUrl=null;
      if(summary.amount_cents===0) {
        await client.query("UPDATE checkout_sessions SET status='approved' WHERE id=$1",[id]);
        await client.query("UPDATE orders SET status='approved' WHERE checkout_id=$1",[id]);
        for(const order of orders) await provisionLicense(client,order);
        if(summary.coupon_id) await client.query('UPDATE coupons SET used_count=used_count+1 WHERE id=$1',[summary.coupon_id]);
      } else {
        const apiOrigin=(process.env.PUBLIC_URL || '').replace(/\/$/,'');
        if(!apiOrigin.startsWith('https://')) fail('Endereço do pagamento ainda não configurado.',503);
        const preference=await mercadoPago('/checkout/preferences',{method:'POST',headers:{'X-Idempotency-Key':id},body:JSON.stringify({
          items:[{id,title:summary.items.map(i=>i.name).join(' + '),quantity:1,currency_id:'BRL',unit_price:summary.amount_cents/100}],
          external_reference:`cart:${id}`,notification_url:`${apiOrigin}/api/mercadopago/webhook`,
          back_urls:{success:`${apiOrigin}/sucesso`,failure:`${apiOrigin}/falha`,pending:`${apiOrigin}/pendente`},
          auto_return:'approved',expires:true,expiration_date_to:new Date(Date.now()+30*60000).toISOString()
        })});
        checkoutUrl=preference.init_point;
        if(!checkoutUrl || new URL(checkoutUrl).protocol!=='https:') fail('O provedor não retornou um endereço de pagamento válido.',502);
        await client.query('UPDATE checkout_sessions SET mercado_pago_id=$1,checkout_url=$2 WHERE id=$3',[preference.id,checkoutUrl,id]);
      }
      await client.query('COMMIT');
      res.status(201).json({checkout_id:id,checkout_url:checkoutUrl,approved:summary.amount_cents===0});
    } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
  }));
  async function confirmCartPayment(payment,owner) {
    const id=String(payment.external_reference || '').slice(5);
    if(!uuid.test(id)) return false;
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const session=(await client.query('SELECT * FROM checkout_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!session || (owner && String(session.user_id)!==String(owner)) || (session.payment_id && String(session.payment_id)!==String(payment.id))) {await client.query('ROLLBACK');return false;}
      if(session.payment_id && (['refunded','charged_back','cancelled'].includes(payment.status) || Number(payment.transaction_amount_refunded || 0)>0)) {
        await client.query("UPDATE checkout_sessions SET status='cancelled' WHERE id=$1",[id]);
        await client.query("UPDATE orders SET status='cancelled' WHERE checkout_id=$1",[id]);
        await client.query("UPDATE licenses SET status='suspended' WHERE order_id IN(SELECT id FROM orders WHERE checkout_id=$1)",[id]);
        await client.query('COMMIT');return false;
      }
      if(!paymentMatches(payment,session) || payment.status!=='approved' || session.status==='cancelled') {await client.query('ROLLBACK');return false;}
      if(session.status==='approved') {await client.query('COMMIT');return true;}
      await client.query("UPDATE checkout_sessions SET status='approved',payment_id=$1 WHERE id=$2",[String(payment.id),id]);
      const orders=(await client.query('SELECT o.id AS order_id,o.user_id,o.product_id,p.slug AS product_slug FROM orders o JOIN products p ON p.id=o.product_id WHERE o.checkout_id=$1',[id])).rows;
      if(!orders.length) fail('Pedido não encontrado.',409);
      await client.query("UPDATE orders SET status='approved' WHERE checkout_id=$1",[id]);
      for(const order of orders) await provisionLicense(client,order);
      if(session.coupon_id) await client.query('UPDATE coupons SET used_count=used_count+1 WHERE id=$1',[session.coupon_id]);
      await client.query('COMMIT');return true;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  return {confirmCartPayment};
}
module.exports=install;
module.exports.normalizeItems=normalizeItems;
module.exports.calculate=calculate;
module.exports.paymentMatches=paymentMatches;
