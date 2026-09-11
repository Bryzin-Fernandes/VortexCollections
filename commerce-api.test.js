const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.PUBLIC_URL='https://api.example';
const commerce=require('./commerce-api');
const {verifyCaptcha,captchaConfig}=require('./auth-api');
const rows=[{id:1,slug:'vortex-bedwars',name:'VortexBedWars',price_cents:15000},{id:2,slug:'vortex-feast',name:'VortexFeast',price_cents:2000}];
test('carrinho de BedWars e Feast totaliza R$170; desconto é calculado em centavos',()=>{
  assert.equal(commerce.calculate(rows).amount_cents,17000);
  const result=commerce.calculate(rows,{code:'VORTEX10',discount_type:'percent',discount_value:10});
  assert.equal(result.amount_cents,15300);assert.equal(result.discount_cents,1700);
  assert.equal(result.items.reduce((n,i)=>n+i.amount_cents,0),15300);
});
test('arredondamento não produz itens negativos nem perde centavos em descontos altos',()=>{
  const products=[1,1,1,1,1].map((v,i)=>({id:i,price_cents:v}));
  const result=commerce.calculate(products,{discount_type:'fixed',discount_value:4});
  assert.equal(result.amount_cents,1);assert.ok(result.items.every(i=>i.amount_cents>=0));
  assert.equal(result.items.reduce((n,i)=>n+i.amount_cents,0),1);
  assert.equal(commerce.calculate(rows,{discount_type:'percent',discount_value:100}).amount_cents,0);
});
test('carrinho rejeita itens duplicados, campos adulterados e lista vazia',()=>{
  for(const items of [[],['vortex-feast','vortex-feast'],[{slug:'vortex-bedwars',price:1}],['../../product']])assert.throws(()=>commerce.normalizeItems({items}));
  assert.deepEqual(commerce.normalizeItems({product:'vortex-feast'}),['vortex-feast']);
});
function harness({coupon=null}={}) {
  const state={session:null,orders:[],licenses:new Set(),preferences:0,couponUses:0,tx:[],sent:null};
  const routes=new Map();const app={get:(p,...h)=>routes.set('GET '+p,h.at(-1)),post:(p,...h)=>routes.set('POST '+p,h.at(-1))};
  const query=async(sql,a=[])=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){state.tx.push(sql);return {rows:[]};}
    if(sql.startsWith('SELECT id FROM users'))return {rows:[{id:9}]};
    if(sql.startsWith('SELECT * FROM checkout_sessions'))return {rows:state.session?[state.session]:[]};
    if(sql.includes('COUNT(*)'))return {rows:[{count:0}]};
    if(sql.startsWith('SELECT id,slug'))return {rows:rows.filter(r=>a[0].includes(r.slug))};
    if(sql.startsWith('SELECT * FROM coupons'))return {rows:coupon?[{...coupon,id:5,used_count:state.couponUses,max_uses:10}]:[]};
    if(sql.startsWith('INSERT INTO checkout_sessions')){state.session={id:a[0],user_id:a[1],request_id:a[2],request_hash:a[3],original_amount_cents:a[4],amount_cents:a[5],discount_cents:a[6],coupon_id:a[7],status:'pending',expires_at:new Date(Date.now()+60000)};return{rows:[]};}
    if(sql.startsWith('INSERT INTO orders')){const id=state.orders.length+1;state.orders.push({order_id:id,user_id:a[0],product_id:a[1],amount_cents:a[2],product_slug:rows.find(r=>r.id===a[1]).slug});return{rows:[{id}]};}
    if(sql.startsWith('UPDATE checkout_sessions SET mercado_pago_id')){state.session.checkout_url=a[1];return{rows:[]};}
    if(sql.startsWith("UPDATE checkout_sessions SET status='approved'")){state.session.status='approved';if(a.length===2)state.session.payment_id=a[0];return{rows:[]};}
    if(sql.startsWith("UPDATE checkout_sessions SET status='cancelled'")){state.session.status='cancelled';return{rows:[]};}
    if(sql.startsWith('SELECT o.id AS order_id'))return {rows:state.orders};
    if(sql.startsWith('UPDATE orders')){state.orders.forEach(o=>o.status=sql.includes("'approved'")?'approved':'cancelled');return{rows:[]};}
    if(sql.startsWith('UPDATE licenses')){state.licenses.clear();return{rows:[]};}
    if(sql.startsWith('UPDATE coupons')){state.couponUses++;return{rows:[]};}
    throw Error('Unexpected query: '+sql);
  };
  const api=commerce({app,pool:{query,connect:async()=>({query,release(){}})},auth(){},mercadoPago:async(_path,options)=>{state.preferences++;state.sent=JSON.parse(options.body);return{id:'pref',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test'};},provisionLicense:async(_client,o)=>state.licenses.add(o.order_id)});
  async function request(path,body){let status=200,data;const res={headersSent:false,status(n){status=n;return this;},json(d){data=d;return this;}};await routes.get(path)({body,user:{sub:'9'}},res);return{status,data};}
  return{state,...api,request};
}
test('checkout ignora preço enviado pelo navegador e cria um pedido por plugin',async()=>{
  const h=harness();const result=await h.request('POST /api/checkout',{items:rows.map(p=>p.slug),amount_cents:1});
  assert.equal(result.status,201);assert.equal(h.state.session.amount_cents,17000);assert.equal(h.state.sent.items[0].unit_price,170);assert.equal(h.state.orders.length,2);assert.equal(h.state.licenses.size,0);
});
test('retentar checkout com a mesma chave não cria preferência ou pedido duplicado',async()=>{
  const h=harness();const body={items:rows.map(p=>p.slug),request_id:'11111111-1111-4111-8111-111111111111'};
  const a=await h.request('POST /api/checkout',body),b=await h.request('POST /api/checkout',body);
  assert.equal(a.data.checkout_id,b.data.checkout_id);assert.equal(h.state.preferences,1);assert.equal(h.state.orders.length,2);
  assert.equal((await h.request('POST /api/checkout',{...body,items:['vortex-feast']})).status,409);
});
test('aprovação confere usuário, valor e moeda; callback repetido libera só uma vez',async()=>{
  const h=harness({coupon:{code:'VORTEX10',discount_type:'percent',discount_value:10}});
  await h.request('POST /api/checkout',{items:rows.map(p=>p.slug),coupon:'VORTEX10'});
  const payment={id:'123',external_reference:'cart:'+h.state.session.id,status:'approved',currency_id:'BRL',transaction_amount:153};
  assert.equal(await h.confirmCartPayment(payment,'88'),false);
  assert.equal(await h.confirmCartPayment({...payment,transaction_amount:1}),false);
  assert.equal(await h.confirmCartPayment({...payment,currency_id:'USD'}),false);
  assert.equal(h.state.licenses.size,0);
  assert.equal(await h.confirmCartPayment(payment,'9'),true);
  assert.equal(await h.confirmCartPayment(payment),true);
  assert.equal(h.state.licenses.size,2);assert.equal(h.state.couponUses,1);
  assert.equal(await h.confirmCartPayment({...payment,status:'refunded',transaction_amount_refunded:153}),false);
  assert.equal(h.state.session.status,'cancelled');assert.equal(h.state.licenses.size,0);
  assert.equal(await h.confirmCartPayment(payment),false);
});
test('cupom de 100% aprova os dois itens atomicamente sem chamar o Mercado Pago',async()=>{
  const h=harness({coupon:{code:'LIBERADO',discount_type:'percent',discount_value:100}});
  const r=await h.request('POST /api/checkout',{items:rows.map(p=>p.slug),coupon:'LIBERADO'});
  assert.equal(r.data.approved,true);assert.equal(h.state.licenses.size,2);assert.equal(h.state.couponUses,1);assert.equal(h.state.preferences,0);assert.equal(h.state.tx.at(-1),'COMMIT');
});
const env={TURNSTILE_SITE_KEY:'public-test-key',TURNSTILE_SECRET_KEY:'private-test-key',TURNSTILE_HOSTNAMES:'loja.example'};
test('CAPTCHA exige configuração completa e nunca libera token ausente',async()=>{
  assert.equal(captchaConfig({}).configured,false);
  await assert.rejects(verifyCaptcha('token','login','127.0.0.1',{}),{status:503});
  await assert.rejects(verifyCaptcha('','login','127.0.0.1',env),{status:400});
});
test('CAPTCHA rejeita falha, ação incorreta e hostname diferente',async()=>{
  for(const data of [{success:false},{success:true,action:'register',hostname:'loja.example'},{success:true,action:'login',hostname:'outro.example'}]){
    await assert.rejects(verifyCaptcha('token','login','127.0.0.1',env,async()=>({ok:true,json:async()=>data})),{status:400});
  }
  await verifyCaptcha('token','login','127.0.0.1',env,async(url,options)=>{assert.match(url,/siteverify$/);const body=JSON.parse(options.body);assert.equal(body.secret,env.TURNSTILE_SECRET_KEY);assert.equal(body.response,'token');return{ok:true,json:async()=>({success:true,action:'login',hostname:'loja.example'})};});
});
test('indisponibilidade do provedor de CAPTCHA mantém o login bloqueado',async()=>{
  await assert.rejects(verifyCaptcha('token','login','127.0.0.1',env,async()=>{throw Error('offline');}),{status:503});
});
