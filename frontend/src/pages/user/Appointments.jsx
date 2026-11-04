import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isAvailable, listServices } from '../../api/services'
import {
  appointmentError,
  bookAppointment,
  cancelAppointment,
  listMyAppointments,
  rescheduleAppointment,
} from '../../api/appointments'
import {
  centralToUtc,
  downloadIcs,
  formatCentral,
  googleCalendarUrl,
  todayInCentral,
  utcToCentralInputs,
} from './appointmentTime'
import './Appointments.css'

const statusLabels = { booked: 'Booked', canceled: 'Canceled', completed: 'Completed' }

function calendarEvent(appointment, serviceName) {
  return {
    id: appointment.id,
    title: `QueueSmart: ${serviceName}`,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    details: `${serviceName} appointment booked through QueueSmart.`,
  }
}

function TimeFields({ idPrefix, value, onChange, disabled }) {
  return (
    <div className="appointments-time-fields">
      <label htmlFor={`${idPrefix}-date`}>
        Date
        <input
          id={`${idPrefix}-date`}
          type="date"
          required
          min={todayInCentral()}
          value={value.date}
          onChange={event => onChange({ ...value, date: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label htmlFor={`${idPrefix}-time`}>
        Time (Central)
        <input
          id={`${idPrefix}-time`}
          type="time"
          required
          step={900}
          value={value.time}
          onChange={event => onChange({ ...value, time: event.target.value })}
          disabled={disabled}
        />
      </label>
    </div>
  )
}

function AppointmentCard({ appointment, serviceName, isBusy, onCancel, onReschedule }) {
  const [isEditing, setIsEditing] = useState(false)
  const [when, setWhen] = useState(() => utcToCentralInputs(appointment.startsAt))
  const isUpcoming = appointment.status === 'booked' && new Date(appointment.startsAt) > new Date()
  const event = calendarEvent(appointment, serviceName)

  async function submitReschedule(formEvent) {
    formEvent.preventDefault()
    const done = await onReschedule(appointment, centralToUtc(when.date, when.time))
    if (done) setIsEditing(false)
  }

  return (
    <li className={`appointments-item is-${appointment.status}`}>
      <div className="appointments-item-top">
        <div>
          <h3>{serviceName}</h3>
          <p className="appointments-when">
            {formatCentral(appointment.startsAt)}
            <span className="appointments-length">
              {' '}· {Math.round((new Date(appointment.endsAt) - new Date(appointment.startsAt)) / 60000)} min
            </span>
          </p>
        </div>
        <span className={`appointments-status appointments-status-${appointment.status}`}>
          {statusLabels[appointment.status]}
        </span>
      </div>

      {isUpcoming && !isEditing && (
        <div className="appointments-actions">
          <a className="button button-secondary" href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
            Add to Google Calendar
          </a>
          <button type="button" className="button-secondary" onClick={() => downloadIcs(event)}>
            Download .ics
          </button>
          <button type="button" className="button-secondary" onClick={() => setIsEditing(true)} disabled={isBusy}>
            Reschedule
          </button>
          <button type="button" className="appointments-cancel" onClick={() => onCancel(appointment)} disabled={isBusy}>
            Cancel
          </button>
        </div>
      )}

      {isUpcoming && isEditing && (
        <form className="appointments-reschedule" onSubmit={submitReschedule}>
          <TimeFields idPrefix={`reschedule-${appointment.id}`} value={when} onChange={setWhen} disabled={isBusy} />
          <div className="appointments-actions">
            <button type="submit" disabled={isBusy}>{isBusy ? 'Saving…' : 'Save new time'}</button>
            <button type="button" className="button-secondary" onClick={() => setIsEditing(false)} disabled={isBusy}>
              Keep current time
            </button>
          </div>
        </form>
      )}
    </li>
  )
}

export default function Appointments() {
  const [services, setServices] = useState([])
  const [appointments, setAppointments] = useState([])
  const [serviceId, setServiceId] = useState('')
  const [when, setWhen] = useState({ date: '', time: '' })
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [message, setMessage] = useState(null)
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    // Services are public, so they still show when the user is logged out.
    const [serviceList, mine] = await Promise.all([
      listServices(),
      listMyAppointments().catch(error => {
        if (error.status === 401) return null
        throw error
      }),
    ])
    return { serviceList, mine }
  }, [])

  function handleError(error) {
    if (error.status === 401) setNeedsLogin(true)
    setMessage({ type: 'error', text: appointmentError(error) })
  }

  useEffect(() => {
    let active = true
    load()
      .then(({ serviceList, mine }) => {
        if (!active) return
        setServices(serviceList)
        setAppointments(mine ?? [])
        setNeedsLogin(mine === null)
      })
      .catch(error => {
        if (!active) return
        if (error.status === 401) setNeedsLogin(true)
        else setMessage({ type: 'error', text: appointmentError(error) })
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [load])

  async function refresh() {
    try {
      setAppointments(await listMyAppointments())
    } catch (error) {
      handleError(error)
    }
  }

  const names = new Map(services.map(service => [service.id, service.name]))
  const nameOf = appointment => names.get(appointment.serviceId) ?? 'Service'
  const bookable = services.filter(isAvailable)
  const now = new Date()
  const upcoming = appointments.filter(a => a.status === 'booked' && new Date(a.startsAt) > now)
  const past = appointments.filter(a => !upcoming.includes(a)).reverse()

  async function handleBook(event) {
    event.preventDefault()
    if (busyId) return
    setBusyId('new')
    setMessage(null)
    try {
      const booked = await bookAppointment(serviceId, centralToUtc(when.date, when.time))
      setAppointments(current => [...current, booked].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
      setWhen({ date: '', time: '' })
      setMessage({ type: 'success', text: `Booked ${nameOf(booked)} for ${formatCentral(booked.startsAt)}.` })
    } catch (error) {
      handleError(error)
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancel(appointment) {
    if (busyId) return
    if (!window.confirm(`Cancel your ${nameOf(appointment)} appointment on ${formatCentral(appointment.startsAt)}?`)) {
      return
    }
    setBusyId(appointment.id)
    setMessage(null)
    try {
      const canceled = await cancelAppointment(appointment.id)
      setAppointments(current => current.map(a => (a.id === canceled.id ? canceled : a)))
      setMessage({ type: 'info', text: `Your ${nameOf(canceled)} appointment was canceled.` })
    } catch (error) {
      handleError(error)
      if (error.status === 409 || error.status === 404) refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function handleReschedule(appointment, startsAt) {
    if (busyId) return false
    setBusyId(appointment.id)
    setMessage(null)
    try {
      const moved = await rescheduleAppointment(appointment.id, startsAt)
      setAppointments(current => current.map(a => (a.id === moved.id ? moved : a))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
      setMessage({ type: 'success', text: `Moved ${nameOf(moved)} to ${formatCentral(moved.startsAt)}.` })
      return true
    } catch (error) {
      handleError(error)
      if (error.status === 404 || error.code === 'INVALID_STATUS') refresh()
      return false
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="appointments">
      <header className="appointments-header">
        <p className="eyebrow">QueueSmart</p>
        <h1>Appointments</h1>
        <p className="appointments-intro">
          Book a time instead of waiting in line. All times are shown in Central Time.
        </p>
      </header>

      {needsLogin && (
        <p className="appointments-alert is-info">
          You are not logged in. <Link to="/login">Log in</Link> to book and manage appointments.
        </p>
      )}

      {message && (
        <p className={`appointments-alert is-${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <form className="card appointments-book" onSubmit={handleBook} aria-labelledby="book-heading">
        <h2 id="book-heading">Book an appointment</h2>
        {isLoading ? (
          <p className="appointments-hint" role="status">Loading services…</p>
        ) : bookable.length === 0 ? (
          <p className="appointments-hint">No services are taking appointments right now.</p>
        ) : (
          <>
            <label htmlFor="book-service">
              Service
              <select
                id="book-service"
                required
                value={serviceId}
                onChange={event => setServiceId(event.target.value)}
                disabled={busyId === 'new' || needsLogin}
              >
                <option value="">Choose a service</option>
                {bookable.map(service => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({service.expectedDurationMinutes} min)
                  </option>
                ))}
              </select>
            </label>
            <TimeFields idPrefix="book" value={when} onChange={setWhen} disabled={busyId === 'new' || needsLogin} />
            <div className="appointments-actions">
              <button type="submit" disabled={Boolean(busyId) || needsLogin}>
                {busyId === 'new' ? 'Booking…' : 'Book appointment'}
              </button>
            </div>
          </>
        )}
      </form>

      <section className="card" aria-labelledby="mine-heading">
        <div className="appointments-toolbar">
          <h2 id="mine-heading">My appointments</h2>
          <button
            type="button"
            className="button-secondary appointments-toggle"
            aria-pressed={showPast}
            onClick={() => setShowPast(value => !value)}
          >
            {showPast ? 'Show upcoming' : 'Show past and canceled'}
          </button>
        </div>

        {isLoading ? (
          <p className="appointments-hint" role="status">Loading your appointments…</p>
        ) : (showPast ? past : upcoming).length === 0 ? (
          <p className="appointments-hint">
            {showPast ? 'No past or canceled appointments.' : 'You have no upcoming appointments.'}
          </p>
        ) : (
          <ul className="appointments-list">
            {(showPast ? past : upcoming).map(appointment => (
              <AppointmentCard
                key={`${appointment.id}-${appointment.startsAt}`}
                appointment={appointment}
                serviceName={nameOf(appointment)}
                isBusy={busyId === appointment.id}
                onCancel={handleCancel}
                onReschedule={handleReschedule}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
