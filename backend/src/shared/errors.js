class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const notImplemented = (feature) => (_req, _res, next) =>
  next(new ApiError(501, 'NOT_IMPLEMENTED', `${feature} is not implemented yet.`));
const notFound = (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found.'));
function errorHandler(err, _req, res, _next) {
  if (err.type === 'entity.parse.failed') err = new ApiError(400, 'INVALID_JSON', 'Invalid JSON body.');
  if (err.type === 'entity.too.large') err = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  const known = err instanceof ApiError;
  res.status(known ? err.status : 500).json({ error: {
    code: known ? err.code : 'INTERNAL_ERROR',
    message: known ? err.message : 'An unexpected error occurred.',
    ...(known && err.details !== undefined ? { details: err.details } : {}),
  } });
}
module.exports = { ApiError, notImplemented, notFound, errorHandler };
