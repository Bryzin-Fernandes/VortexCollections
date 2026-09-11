const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.LICENSE_SECRET = 'test-only-secret-not-for-production';
const vault = require('./license-vault');
const install = require('./customer-api');
test('vault recovers key and rejects tampering or another order', () => {
  const encoded = vault.encrypt('VTX-TEST', 5);
  assert.equal(vault.decrypt(encoded, 5), 'VTX-TEST');
  assert.throws(() => vault.decrypt(encoded, 6));
  assert.throws(() => vault.decrypt(encoded.slice(0, -5) + 'AAAAA', 5));
});
test('payment must match order, amount, currency and no refund', () => {
  const order = { order_id: 5, amount_cents: 12500 };
  const p = { external_reference: '5', currency_id: 'BRL', transaction_amount: 125 };
  assert.equal(install.paymentMatches(p, order), true);
  for (const change of [{ external_reference: '6' }, { currency_id: 'USD' }, { transaction_amount: 20 }, { transaction_amount_refunded: 1 }])
    assert.equal(install.paymentMatches({ ...p, ...change }, order), false);
});
function harness(query, connect = async () => ({ query, release() {} })) {
  const routes = new Map(); const app = { set() {}, use() {} };
  for (const method of ['get','post','delete']) app[method] = (path, ...handlers) => routes.set(method + path, handlers);
  install({ app, pool: { query, connect }, auth: (_req,_res,next) => next(), bcrypt: { compare: async () => true }, vault, fingerprint: k => k });
  return async (route, body, extra = {}) => {
    let status = 200, data;
    const req = { user: { sub: '2' }, params: { id: '3' }, body, ip: '198.51.100.8', ...extra };
    const res = { headersSent: false, status(s) { status=s; return this; }, json(d) { data=d; return this; }, sendStatus(s) { status=s; return this; } };
    await routes.get(route).at(-1)(req, res);
    return { status, data };
  };
}
test('another customer cannot change IPs, download or reissue by supplying an ID', async () => {
  const api = harness(async (sql,args) => {
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql) || sql.includes('FOR UPDATE')) return { rows: [] };
    assert.match(sql, /l.user_id=\$2/); assert.deepEqual(args, ['3','2']); return { rows: [] };
  });
  assert.equal((await api('post/api/licenses/:id/ip', { ip: '203.0.113.3' })).status, 404);
  assert.equal((await api('delete/api/licenses/:id/ip', { ip: '203.0.113.3' })).status, 404);
  assert.equal((await api('get/api/licenses/:id/download', {})).status, 404);
});
test('CIDR cannot authorize an entire network', async () => {
  const api = harness(() => { throw Error('DB must not be called'); });
  assert.equal((await api('post/api/licenses/:id/ip', { ip: '0.0.0.0/0' })).status, 400);
});
test('verify uses observed IP, not client-controlled IP', async () => {
  let count=0;
  const api = harness(async (sql,args) => {
    if (!count++) return { rows: [{ id: 3, license_key_hash: 'hash' }] };
    assert.equal(args[1], '198.51.100.8'); return { rowCount: 0 };
  });
  assert.deepEqual((await api('post/api/license/verify', { key: 'key', product: 'vortex-kitpvp', ip: '203.0.113.1' })).data, { valid: true, ip_authorized: false, server_ip: '198.51.100.8' });
});
test('legacy license listing does not generate or expose a fake key', async () => {
  const api = harness(async () => ({ rows: [{ id: 3, status: 'active', order_status: 'approved', slug: 'vortex-kitpvp', product: 'VortexKitPvP', authorized_ips: [], key_encrypted: null }] }));
  const result = await api('get/api/me/licenses', {});
  assert.equal(result.data[0].key, null); assert.equal(result.data[0].needs_reissue, true);
});
test('simultaneous registrations serialize and only one different IP wins', async () => {
  const ips = []; let queue = Promise.resolve();
  const connect = async () => {
    let unlock;
    return { release() {}, async query(sql, args) {
      if (sql.includes('FOR UPDATE')) {
        const previous = queue; queue = new Promise(resolve => { unlock = resolve; });
        await previous; return { rows: [{ id: 3 }] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') { unlock?.(); return { rows: [] }; }
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('FROM licenses l')) return { rows: [{ id: 3 }] };
      if (sql.startsWith('SELECT ip_address')) return { rows: ips.map(ip => ({ same: ip === args[1] })) };
      if (sql.startsWith('INSERT')) { ips.push(args[1]); return { rows: [] }; }
      throw Error('Unexpected query');
    } };
  };
  const api = harness(() => { throw Error('must use transaction'); }, connect);
  const results = await Promise.all(['203.0.113.1','203.0.113.2'].map(ip => api('post/api/licenses/:id/ip', { ip })));
  assert.deepEqual(results.map(r => r.status).sort(), [200,409]); assert.equal(ips.length,1);
  assert.equal((await api('post/api/licenses/:id/ip', { ip: ips[0] })).status,200);
  assert.equal(ips.length,1);
  ips.push('203.0.113.3');
  assert.equal((await api('post/api/licenses/:id/ip', { ip: ips[0] })).status,409);
});
test('verification requires exactly one authorized row even for a matching IP', async () => {
  const api = harness(async sql => {
    if (sql.startsWith('SELECT l.id')) return { rows: [{ id: 3, license_key_hash: 'hash' }] };
    assert.match(sql, /SELECT COUNT\(\*\) FROM authorized_ips WHERE license_id=\$1\)=1/);
    return { rowCount: 0 };
  });
  const result = await api('post/api/license/verify', { key: 'key', product: 'vortex-feast' });
  assert.equal(result.status,403); assert.equal(result.data.ip_authorized,false);
});
