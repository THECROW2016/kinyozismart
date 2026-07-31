const crypto = require('crypto');

function hashPin(pin) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const checkBuf = Buffer.from(check, 'hex');
  if (hashBuf.length !== checkBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, checkBuf);
}

module.exports = { hashPin, verifyPin };
