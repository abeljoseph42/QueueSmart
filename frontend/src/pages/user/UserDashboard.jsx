import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import NotificationList from '../../components/notifications/NotificationList'
import { getDashboard } from '../../api/user'
import { statusLabel } from '../../api/queue'
import './UserDashboard.css'

const statusPath = (serviceId) =>
  `/queue-status?service=${encodeURIComponent(serviceId)}`

function ServiceAction({ service, isQueued }) {
  if (isQueued) {
    return (
      <Link
        to={statusPath(service.id)}
        className="button dashboard-service-action"
        aria-label={`View queue status for ${service.name}`}
      >
        View status
      </Link>
    )
  }

  if (!service.isOpen) {
    return (
      <button type="button" className="dashboard-service-action" disabled>
        Queue closed
      </button>
    )
  }

  return (
    <Link
      to="/join-queue"
      className="button button-secondary dashboard-service-action"
      aria-label={`Join queue for ${service.name}`}
    >
      Join queue
    </Link>
  )
}

export default function UserDashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getDashboard()
      .then((data) => {
        if (active) setDashboard(data)
      })
      .catch((err) => {
        if (!active) return
        if (err.status === 401) setNeedsLogin(true)
        else setError(err.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const header = (
    <header className="dashboard-header">
      <p className="eyebrow">QueueSmart</p>
      <h1>User Dashboard</h1>
      <p className="dashboard-intro">
        Track your place in line and browse available services.
      </p>
    </header>
  )

  if (isLoading || !dashboard) {
    return (
      <div className="dashboard">
        {header}
        <section className="card">
          {isLoading && <p className="dashboard-empty">Loading your dashboard...</p>}
          {needsLogin && (
            <p className="dashboard-empty" role="alert">
              You are not logged in. <Link to="/login">Log in</Link> to see your dashboard.
            </p>
          )}
          {error && (
            <p className="dashboard-empty" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    )
  }

  const { services, queues, notifications } = dashboard
  const serviceName = (id) =>
    services.find((service) => service.id === id)?.name ?? 'Service'
  const queuedIds = new Set(queues.map((queue) => queue.entry.serviceId))

  return (
    <div className="dashboard">
      {header}

      <div className="dashboard-overview">
        <section className="card" aria-labelledby="current-queue-heading">
          <h2 id="current-queue-heading">
            {queues.length > 1 ? 'Current queues' : 'Current queue'}
          </h2>

          {queues.length > 0 ? (
            queues.map((queue) => (
              <div key={queue.entry.id}>
                <p className="dashboard-service-name">
                  {serviceName(queue.entry.serviceId)}
                </p>

                <dl className="dashboard-stats">
                  <div className="dashboard-stat">
                    <dt>Status</dt>
                    <dd>{statusLabel(queue.position)}</dd>
                  </div>
                  <div className="dashboard-stat">
                    <dt>Position</dt>
                    <dd>#{queue.position}</dd>
                  </div>
                  <div className="dashboard-stat">
                    <dt>Estimated wait</dt>
                    <dd>{queue.estimatedWaitMinutes} min</dd>
                  </div>
                </dl>

                <Link to={statusPath(queue.entry.serviceId)} className="button">
                  View queue status
                </Link>
              </div>
            ))
          ) : (
            <>
              <p className="dashboard-empty">
                You are not in a queue right now.
              </p>
              <Link to="/join-queue" className="button">
                Join a queue
              </Link>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="notifications-heading">
          <div className="dashboard-notifications-header">
            <h2 id="notifications-heading">Notifications</h2>
          </div>

          <NotificationList notifications={notifications} />
        </section>
      </div>

      <section className="card" aria-labelledby="services-heading">
        <h2 id="services-heading">Available services</h2>

        {services.length === 0 ? (
          <p className="dashboard-empty">No services are available yet.</p>
        ) : (
          <ul className="dashboard-services">
            {services.map((service) => (
              <li key={service.id} className="dashboard-service">
                <div className="dashboard-service-heading">
                  <h3>{service.name}</h3>
                  <span
                    className={
                      service.isOpen
                        ? 'dashboard-badge dashboard-badge-open'
                        : 'dashboard-badge dashboard-badge-closed'
                    }
                  >
                    {service.isOpen ? 'Open' : 'Closed'}
                  </span>
                </div>

                <p className="dashboard-service-description">
                  {service.description}
                </p>

                {service.isOpen ? (
                  <dl className="dashboard-service-details">
                    <div>
                      <dt>Time per person</dt>
                      <dd>{service.expectedDurationMinutes} min</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="dashboard-empty">
                    This queue is not accepting new people right now.
                  </p>
                )}

                <ServiceAction
                  service={service}
                  isQueued={queuedIds.has(service.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
