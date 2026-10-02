import { Link } from 'react-router-dom'
import {
  availableServices,
  currentQueue,
  recentNotifications,
} from './userDashboardData'
import './UserDashboard.css'

export default function UserDashboard() {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <p className="eyebrow">QueueSmart</p>
        <h1>User Dashboard</h1>
        <p className="dashboard-intro">
          Track your place in line and browse available services.
        </p>
      </header>

      <div className="dashboard-overview">
        <section className="card" aria-labelledby="current-queue-heading">
          <h2 id="current-queue-heading">Current queue</h2>

          {currentQueue ? (
            <>
              <p className="dashboard-service-name">
                {currentQueue.serviceName}
              </p>

              <dl className="dashboard-stats">
                <div className="dashboard-stat">
                  <dt>Status</dt>
                  <dd>{currentQueue.status}</dd>
                </div>
                <div className="dashboard-stat">
                  <dt>Position</dt>
                  <dd>#{currentQueue.position}</dd>
                </div>
                <div className="dashboard-stat">
                  <dt>Estimated wait</dt>
                  <dd>{currentQueue.estimatedWaitMinutes} min</dd>
                </div>
              </dl>

              <Link to="/queue-status" className="button">
                View queue status
              </Link>
            </>
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
          <h2 id="notifications-heading">Notifications</h2>

          {recentNotifications.length > 0 ? (
            <ul className="dashboard-notifications">
              {recentNotifications.map((notification) => (
                <li key={notification.id}>{notification.message}</li>
              ))}
            </ul>
          ) : (
            <p className="dashboard-empty">No new notifications.</p>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="services-heading">
        <h2 id="services-heading">Available services</h2>

        <ul className="dashboard-services">
          {availableServices.map((service) => (
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
                    <dt>In queue</dt>
                    <dd>{service.peopleWaiting} waiting</dd>
                  </div>
                  <div>
                    <dt>Estimated wait</dt>
                    <dd>{service.estimatedWaitMinutes} min</dd>
                  </div>
                </dl>
              ) : (
                <p className="dashboard-empty">
                  This queue is not accepting new people right now.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
