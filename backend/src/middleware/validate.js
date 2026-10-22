const { ApiError } = require('../shared/errors');
const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) return next(new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
    result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))));
  req.validated = { ...req.validated, [source]: result.data };
  next();
};
module.exports = { validate };
