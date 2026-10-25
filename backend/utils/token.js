const crypto = require('crypto');

// Set SESSION_SECRET in production so sessions survive restarts. Without it a
// random secret is generated per process (sessions end on every restart).
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set; using a random per-process secret (logins reset on restart).');
}
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const b64 = (b) => Buffer.from(b).toString('base64url');

function sign(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + MAX_AGE_MS }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest();
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch (e) { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

module.exports = { sign, verify };
