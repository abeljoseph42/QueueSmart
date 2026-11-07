import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { appointmentError, listMyNotifications, markNotificationViewed } from '../../api/appointments'
import { formatCentral } from './appointmentTime'
import './NotificationHistory.css'

const typeLabels = {
  'appointment.booked': 'Appointment booked',
  'appointment.rescheduled': 'Appointment rescheduled',
  'appointment.canceled': 'Appointment canceled',
  'queue.joined': 'Joined queue',
  'queue.served': 'Served',
}

// Email delivery status, plus whether the user has opened it here.
const statusLabels = {
  pending: 'Email sending',
  sent: 'Emailed',
  failed: 'Email failed',
  viewed: 'Viewed',
}

export default function NotificationHistory() {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    listMyNotifications(page)
      .then(data => {
        if (active) setResult(data)
      })
      .catch(err => {
        if (!active) return
        if (err.status === 401) setNeedsLogin(true)
        else setError(appointmentError(err))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [page])

  function goTo(next) {
    setIsLoading(true)
    setError('')
    setPage(next)
  }

  async function handleView(notification) {
    setBusyId(notification.id)
    setError('')
    try {
      const viewed = await markNotificationViewed(notification.id)
      setResult(current => ({
        ...current,
        items: current.items.map(item => (item.id === viewed.id ? viewed : item)),
      }))
    } catch (err) {
      if (err.status === 401) setNeedsLogin(true)
      else setError(appointmentError(err))
    } finally {
      setBusyId(null)
    }
  }

  const items = result?.items ?? []

  return (
    <div className="notification-history">
      <header className="notification-history-header">
        <p className="eyebrow">QueueSmart</p>
        <h1>Notifications</h1>
        <p className="notification-history-intro">
          Updates about your appointments, newest first. Times are in Central Time.
        </p>
      </header>

      <section className="card" aria-labelledby="notification-history-heading">
        <h2 id="notification-history-heading">Notification history</h2>

        {error && <p className="notification-history-error" role="alert">{error}</p>}

        {isLoading ? (
          <p className="notification-history-empty" role="status">Loading notifications…</p>
        ) : needsLogin ? (
          <p className="notification-history-empty" role="alert">
            You are not logged in. <Link to="/login">Log in</Link> to see your notifications.
          </p>
        ) : items.length === 0 ? (
          <p className="notification-history-empty">
            {page === 1 ? 'You have no notifications yet.' : 'There are no notifications on this page.'}
          </p>
        ) : (
          <ul className="notification-history-list">
            {items.map(notification => {
              const isNew = notification.status !== 'viewed'
              return (
                <li key={notification.id} className={`notification-history-item${isNew ? ' is-new' : ''}`}>
                  <div className="notification-history-meta">
                    <span className="notification-history-type">
                      {typeLabels[notification.type] ?? 'Update'}
                    </span>
                    <span className={`notification-history-status is-${
                      notification.deliveryUnavailable ? 'unavailable' : notification.status}`}>
                      {notification.deliveryUnavailable ? 'Delivery unavailable' : statusLabels[notification.status]}
                    </span>
                    <time dateTime={notification.createdAt} className="notification-history-time">
                      {formatCentral(notification.createdAt)}
                    </time>
                  </div>
                  <h3>{notification.subject}</h3>
                  <p>{notification.message}</p>
                  {isNew && (
                    <button
                      type="button"
                      className="button-secondary notification-history-view"
                      onClick={() => handleView(notification)}
                      disabled={busyId === notification.id}
                    >
                      {busyId === notification.id ? 'Saving…' : 'Mark as viewed'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {result && result.totalPages > 1 && (
          <nav className="notification-history-pages" aria-label="Notification pages">
            <button type="button" className="button-secondary" onClick={() => goTo(page - 1)}
              disabled={isLoading || page <= 1}>
              Newer
            </button>
            <span>Page {page} of {result.totalPages}</span>
            <button type="button" className="button-secondary" onClick={() => goTo(page + 1)}
              disabled={isLoading || page >= result.totalPages}>
              Older
            </button>
          </nav>
        )}
      </section>
    </div>
  )
}
