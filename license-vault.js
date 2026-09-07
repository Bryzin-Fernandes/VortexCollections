const crypto = require('crypto');
function vaultKey() {
  const secret = process.env.LICENSE_SECRET;
  if (!secret) throw new Error('LICENSE_SECRET ausente');
  return crypto.createHash('sha256').update('vortex-vault-v1:' + secret).digest();
}
function encrypt(key, orderId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv);
  cipher.setAAD(Buffer.from(String(orderId)));
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
}
function decrypt(value, orderId) {
  const [iv, tag, encrypted] = value.split('.').map(s => Buffer.from(s, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', vaultKey(), iv);
  cipher.setAAD(Buffer.from(String(orderId)));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}
module.exports = { encrypt, decrypt };
