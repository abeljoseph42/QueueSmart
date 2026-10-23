const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:3001/api'
).replace(/\/$/, '')

const TOKEN_KEY = 'queuesmart.token'

export function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function apiRequest(
  path,
  { method = 'GET', body, authenticated = true } = {},
) {
  const headers = new Headers()

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (authenticated) {
    const token = sessionStorage.getItem(TOKEN_KEY)

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }

  let response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
    })
  } catch {
    throw new Error(
      'Cannot connect to QueueSmart. Check that the backend is running.',
    )
  }

  let payload

  try {
    payload = await response.json()
  } catch {
    throw new Error('The server returned an unexpected response.')
  }

  if (!response.ok) {
    if (authenticated && response.status === 401) {
      clearSession()
    }

    const error = new Error(
      payload.error?.message || 'The request failed.',
    )

    error.status = response.status
    error.code = payload.error?.code
    error.details = payload.error?.details

    throw error
  }

  return payload.data
}