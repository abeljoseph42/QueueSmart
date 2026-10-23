// The backend allows CORS from the Vite dev origin, so requests go straight to the API.
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001/api'
// Nik owns token storage: this key must match the one his login code writes.
const TOKEN_KEY = 'token'

export class ApiRequestError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {}
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError('Could not reach the server. Is the backend running?', 0, 'NETWORK_ERROR')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const { code, message } = payload.error ?? {}
    throw new ApiRequestError(message ?? `Request failed (${response.status}).`, response.status, code)
  }
  return payload.data
}

export function describeError(error) {
  if (error.status === 401) return 'Log in as an admin to use this page.'
  if (error.status === 403) return 'You need an admin account to use this page.'
  if (error.status === 501) return 'Not available yet.'
  return error.message
}
