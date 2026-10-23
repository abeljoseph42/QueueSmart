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