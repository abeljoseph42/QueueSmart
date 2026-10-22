const { ApiError } = require('../shared/errors');
const { user } = require('../shared/contracts');
// Nik replaces the resolver with verified bearer-token/session lookup.
// Never trust a role, user ID, or token supplied by a browser without verification.
const requireAuth = (resolveUser = async () => null) => async (req, _res, next) => {
  try {
    const identity = await resolveUser(req);
    if (!identity) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
    req.user = user.parse(identity);
    next();
  } catch (err) { next(err); }
};
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  if (!roles.includes(req.user.role)) return next(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.'));
  next();
};
module.exports = { requireAuth, requireRole };
