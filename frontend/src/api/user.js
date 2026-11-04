import { apiRequest } from './client'

export function getDashboard() {
  return apiRequest('/me/dashboard')
}

export function getHistory() {
  return apiRequest('/me/history')
}

export function getProfile() {
  return apiRequest('/me/profile')
}

export function updateProfile(body) {
  return apiRequest('/me/profile', {
    method: 'PATCH',
    body,
  })
}