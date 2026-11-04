import { apiRequest } from './client'

function toScreenService(service) {
  return {
    ...service,
    expectedDuration: service.expectedDurationMinutes,
  }
}

function toRequestBody(form) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    expectedDurationMinutes: Number(form.expectedDuration),
    priority: form.priority,
  }
}

export async function listServices() {
  const services = await apiRequest('/services', {
    authenticated: false,
  })

  return services.map(toScreenService)
}

export async function createService(form) {
  const service = await apiRequest('/services', {
    method: 'POST',
    body: toRequestBody(form),
  })

  return toScreenService(service)
}

export async function updateService(serviceId, form) {
  const service = await apiRequest(
    `/services/${encodeURIComponent(serviceId)}`,
    {
      method: 'PATCH',
      body: toRequestBody(form),
    },
  )

  return toScreenService(service)
}

export async function setServiceActive(serviceId, isActive) {
  const service = await apiRequest(
    `/services/${encodeURIComponent(serviceId)}`,
    {
      method: 'PATCH',
      body: { isActive },
    },
  )

  return toScreenService(service)
}

export async function setQueueOpen(serviceId, isOpen) {
  const service = await apiRequest(
    `/admin/services/${encodeURIComponent(serviceId)}/queue`,
    {
      method: 'PATCH',
      body: { isOpen },
    },
  )

  return toScreenService(service)
}

export const isAvailable = service => service.isActive !== false

const friendlyMessages = {
  QUEUE_CLOSED: 'This queue is closed right now. Please try again later.',
  SERVICE_INACTIVE: 'This service is not available right now.',
  ALREADY_IN_QUEUE: 'You are already waiting in this queue.',
  DATABASE_BUSY: 'QueueSmart is busy right now. Please try again in a moment.',
}

export function friendlyError(error) {
  return friendlyMessages[error?.code] || error?.message || 'The request failed.'
}
