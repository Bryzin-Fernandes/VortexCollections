// Cloudflare Turnstile is verified here, never just in the browser.
const crypto = require('crypto');
function captchaConfig(env = process.env) {
  const enabled = env.TURNSTILE_ENABLED !== 'false';
  const siteKey = env.TURNSTILE_SITE_KEY || '';
  const hostnames = (env.TURNSTILE_HOSTNAMES || '').split(',').map(s => s.trim()).filter(Boolean);
  return { enabled, siteKey, configured: !enabled || Boolean(siteKey && env.TURNSTILE_SECRET_KEY && hostnames.length), hostnames };
}
async function verifyCaptcha(token, action, ip, env = process.env, request = fetch) {
  const config = captchaConfig(env);
  if (!config.enabled) return;
  if (!config.configured) throw Object.assign(Error('A verificação de segurança está sendo configurada. Fale com o suporte.'), { status: 503 });
  if (typeof token !== 'string' || !token || token.length > 2048) throw Object.assign(Error('Conclua a verificação de segurança.'), { status: 400 });
  let result;
  try {
    const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip, idempotency_key: crypto.randomUUID() })
    });
    if (!response.ok) throw Error('siteverify');
    result = await response.json();
  } catch (_) { throw Object.assign(Error('Não foi possível verificar o CAPTCHA. Tente novamente.'), { status: 503 }); }
  if (!result.success || result.action !== action || !config.hostnames.includes(result.hostname))
    throw Object.assign(Error('Verificação expirada ou inválida. Conclua o CAPTCHA novamente.'), { status: 400 });
}
function install({ app, pool, bcrypt, issueToken, auth }) {
  const attempts = new Map();
  const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req,res)).catch(e => {
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'Não foi possível concluir. Tente novamente.' });
  });
  const throttle = req => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.end < now) attempts.delete(key);
    const key = req.ip || 'unknown';
    const entry = attempts.get(key) || { count: 0, end: now + 15 * 60000 };
    if (++entry.count > 30) throw Object.assign(Error('Muitas tentativas. Aguarde 15 minutos e tente novamente.'), { status: 429 });
    attempts.set(key, entry);
  };
  app.get('/api/auth/config', (_req, res) => { const c = captchaConfig(); res.json({ captcha_enabled: c.enabled, captcha_configured: c.configured, site_key: c.siteKey }); });
  app.post('/api/auth/register', wrap(async (req,res) => {
    throttle(req);
    const { name, email, password, minecraft_nick, captcha_token } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || typeof email !== 'string' || email.length > 190 || !/^\S+@\S+\.\S+$/.test(email.trim()) || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72)
      return res.status(400).json({ error: 'Preencha nome, e-mail válido e senha de 8 a 72 bytes.' });
    const nick = typeof minecraft_nick === 'string' ? minecraft_nick.trim() : '';
    if (nick && !/^[a-zA-Z0-9_]{3,16}$/.test(nick)) return res.status(400).json({ error: 'Nick Minecraft: use 3 a 16 letras, números ou _.' });
    await verifyCaptcha(captcha_token, 'register', req.ip);
    try {
      const user = (await pool.query('INSERT INTO users (name,email,password_hash,minecraft_nick) VALUES ($1,LOWER($2),$3,$4) RETURNING id,name,email,role,minecraft_nick', [name.trim(), email.trim(), await bcrypt.hash(password,12), nick || null])).rows[0];
      res.status(201).json({ user, token: issueToken(user, req.body.remember === true) });
    } catch(e) { if(e.code === '23505') return res.status(409).json({error:'E-mail já cadastrado.'}); throw e; }
  }));
  app.post('/api/auth/login', wrap(async (req,res) => {
    throttle(req);
    const { email, password, captcha_token } = req.body || {};
    if(typeof email !== 'string' || email.length > 190 || typeof password !== 'string' || Buffer.byteLength(password) > 72) return res.status(400).json({error:'Informe e-mail e senha válidos.'});
    await verifyCaptcha(captcha_token, 'login', req.ip);
    const user = (await pool.query('SELECT id,name,email,role,minecraft_nick,password_hash FROM users WHERE email=LOWER($1)', [email.trim()])).rows[0];
    if(!user || !await bcrypt.compare(password, user.password_hash)) return res.status(401).json({error:'E-mail ou senha inválidos.'});
    delete user.password_hash;
    res.json({user, token: issueToken(user, req.body.remember === true)});
  }));
  app.patch('/api/me/profile', auth, wrap(async (req,res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const nick = typeof req.body.minecraft_nick === 'string' ? req.body.minecraft_nick.trim() : '';
    if(!name || name.length>120 || (nick && !/^[a-zA-Z0-9_]{3,16}$/.test(nick))) return res.status(400).json({error:'Confira o nome e o nick (3 a 16 letras, números ou _).'});
    const user = (await pool.query('UPDATE users SET name=$1,minecraft_nick=$2 WHERE id=$3 RETURNING id,name,email,role,minecraft_nick', [name,nick||null,req.user.sub])).rows[0];
    if(!user) return res.sendStatus(401);
    res.json(user);
  }));
}
module.exports = install;
module.exports.verifyCaptcha = verifyCaptcha;
module.exports.captchaConfig = captchaConfig;
