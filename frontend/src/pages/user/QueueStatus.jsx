import { Link, useLocation } from 'react-router-dom'
import './QueueStatus.css'


const demoQueue = {
  serviceName: 'Academic Advising',
  position: 4,
  estimatedWait: 12,
}

const statusSteps = ['Joined', 'Waiting', 'Almost Ready', 'Served']

export default function QueueStatus() {
  const location = useLocation()
  const queue = location.state?.serviceName ? location.state : demoQueue
  const isDemo = queue === demoQueue

  const status = 'Waiting'
  const currentStep = statusSteps.indexOf(status)

  return (
    <section className="queue-status">
      <header className="queue-status-header">
        <p className="eyebrow">Queue Status</p>
        <h1>{queue.serviceName}</h1>
        <p className="queue-status-subtitle">
          {isDemo
            ? 'Showing a sample queue. Join a queue to see your own status.'
            : 'Here is where you are in line.'}
        </p>
      </header>

      <div className="queue-status-grid">
        <div className="queue-status-stat card">
          <p className="queue-status-label">Current position</p>
          <p className="queue-status-value">#{queue.position}</p>
        </div>
        <div className="queue-status-stat card">
          <p className="queue-status-label">Estimated wait</p>
          <p className="queue-status-value">{queue.estimatedWait} min</p>
        </div>
        <div className="queue-status-stat card">
          <p className="queue-status-label">Status</p>
          <p className="queue-status-value">
            <span className="queue-status-badge">{status}</span>
          </p>
        </div>
      </div>

      <div className="queue-status-progress card">
        <h2>Progress</h2>
        <ol className="queue-status-steps">
          {statusSteps.map((step, index) => {
            let stepState = 'is-upcoming'
            if (index < currentStep) stepState = 'is-complete'
            if (index === currentStep) stepState = 'is-current'

            return (
              <li
                key={step}
                className={`queue-status-step ${stepState}`}
                aria-current={index === currentStep ? 'step' : undefined}
              >
                <span className="queue-status-dot">
                  {index < currentStep ? '✓' : index + 1}
                </span>
                <span className="queue-status-step-label">{step}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="queue-status-actions">
        <Link to="/join-queue" className="button button-secondary">
          Back to Join Queue
        </Link>
      </div>
    </section>
  )
}