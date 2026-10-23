export function isLoginError(error) {
  return error?.status === 401
}

export function describeError(error) {
  if (error?.status === 401) return 'Your session has expired or you are not logged in.'
  if (error?.status === 403) return 'You need administrator access to use this page.'
  if (error?.status === 501) return 'Not available yet.'
  if (!error?.status) return error?.message || 'Could not reach the server. Is the backend running?'
  const details = Array.isArray(error.details) ? error.details : []
  const extra = details.map((detail) => (detail.path ? `${detail.path}: ${detail.message}` : detail.message)).join('; ')
  return extra ? `${error.message} ${extra}` : error.message
}

export const toFailure = (error) => ({ text: describeError(error), login: isLoginError(error) })
