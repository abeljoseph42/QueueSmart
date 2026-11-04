import { apiRequest } from './client'

const id = value => encodeURIComponent(value)

export function bookAppointment(serviceId, startsAt) {
  return apiRequest('/appointments', { method: 'POST', body: { serviceId, startsAt } })
}

export function listMyAppointments() {
  return apiRequest('/me/appointments')
}

export function cancelAppointment(appointmentId) {
  return apiRequest(`/me/appointments/${id(appointmentId)}/cancel`, { method: 'POST' })
}

export function rescheduleAppointment(appointmentId, startsAt) {
  return apiRequest(`/me/appointments/${id(appointmentId)}/reschedule`, {
    method: 'POST',
    body: { startsAt },
  })
}

// Returns { items, page, pageSize, total, totalPages }; 20 per page, newest first.
export function listMyNotifications(page = 1) {
  return apiRequest(`/me/notifications?page=${id(page)}`)
}

export function markNotificationViewed(notificationId) {
  return apiRequest(`/me/notifications/${id(notificationId)}/view`, { method: 'POST' })
}

const friendlyMessages = {
  SERVICE_INACTIVE: 'This service is not taking appointments right now. Please pick another service.',
  INVALID_STATUS: 'This appointment can no longer be changed. Refresh to see its latest status.',
  NOT_FOUND: 'We could not find that appointment. It may have been removed.',
  DATABASE_BUSY: 'QueueSmart is busy right now. Please try again in a moment.',
}

const conflictMessages = {
  'This time slot is already booked for the service.':
    'That time is already taken for this service. Please choose another time.',
  'You already have an appointment at this time.':
    'You already have another appointment at that time. Please choose another time.',
}

export function appointmentError(error) {
  if (error?.status === 401) return 'Please log in to manage your appointments.'
  if (error?.code === 'SLOT_CONFLICT') {
    return conflictMessages[error.message] || 'That time is not available. Please choose another time.'
  }
  if (error?.code === 'VALIDATION_ERROR' && error.details?.[0]?.path === 'startsAt') {
    return error.details[0].message
  }
  return friendlyMessages[error?.code] || error?.message || 'The request failed.'
}
