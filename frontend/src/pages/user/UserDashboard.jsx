import { Link } from 'react-router-dom'
import { currentQueue } from './userDashboardData'
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
      </div>

      <section className="card" aria-labelledby="services-heading">
        <h2 id="services-heading">Available services</h2>
        <p className="dashboard-empty">
          Services you can line up for will be listed here.
        </p>
      </section>
    </div>
  )
}
