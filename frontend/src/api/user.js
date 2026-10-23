import { apiRequest } from './client'

export function getDashboard() {
  return apiRequest('/me/dashboard')
}

export function getHistory() {
  return apiRequest('/me/history')
}
