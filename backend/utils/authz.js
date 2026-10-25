const { verify } = require('./token');

// Requires a valid Bearer token. Pins shop_id to the one in the token so a
// client cannot read or write another shop's data by changing the parameter.
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = h.startsWith('Bearer ') ? verify(h.slice(7)) : null;
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  if (req.query && req.query.shop_id !== undefined) req.query.shop_id = user.shop_id;
  if (req.body && typeof req.body === 'object' && 'shop_id' in req.body) req.body.shop_id = user.shop_id;
  if (req.body && typeof req.body === 'object' && 'created_by' in req.body) req.body.created_by = user.id;
  next();
}

const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user && req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' });

// Secretaries can never delete anything.
const noSecretaryDelete = (req, res, next) =>
  req.method === 'DELETE' && req.user.role === 'secretary'
    ? res.status(403).json({ error: 'Not allowed for your role' })
    : next();

module.exports = { requireAuth, allow, noSecretaryDelete };
