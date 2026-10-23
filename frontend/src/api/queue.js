import { apiRequest } from './client'

const queuePath = serviceId => `/services/${encodeURIComponent(serviceId)}/queue`

export function joinQueue(serviceId) {
  return apiRequest(`${queuePath(serviceId)}/join`, { method: 'POST', body: {} })
}

export function leaveQueue(serviceId) {
  return apiRequest(`${queuePath(serviceId)}/me`, { method: 'DELETE' })
}

export async function getMyQueueStatus(serviceId) {
  try {
    return await apiRequest(`${queuePath(serviceId)}/me`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

export async function getMyQueues(services) {
  const results = await Promise.all(services.map(service => getMyQueueStatus(service.id)))
  const queues = {}
  services.forEach((service, i) => {
    if (results[i]) queues[service.id] = results[i]
  })
  return queues
}

export function statusLabel(position) {
  return position <= 2 ? 'Almost Ready' : 'Waiting'
}