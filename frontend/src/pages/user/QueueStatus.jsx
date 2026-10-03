import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './QueueStatus.css'

const demoQueue = {
  serviceName: 'Academic Advising',
  position: 4,
  estimatedWait: 12,
}

const statusSteps = ['Joined', 'Waiting', 'Almost Ready', 'Served']

const badgeClass = {
  Waiting: 'is-waiting',
  'Almost Ready': 'is-almost',
  Served: 'is-served',
}

export default function QueueStatus() {
  const location = useLocation()
  const queue = location.state?.serviceName ? location.state : demoQueue
  const isDemo = queue === demoQueue

  const [position, setPosition] = useState(queue.position)
  const [status, setStatus] = useState(queue.position <= 1 ? 'Almost Ready' : 'Waiting')
  const [update, setUpdate] = useState(null)


  const estimatedWait =
    status === 'Served'
      ? 0
      : Math.round((queue.estimatedWait * position) / queue.position)

  const currentStep = statusSteps.indexOf(status)

  function handleSimulate() {
    if (status === 'Served') return

    if (status === 'Almost Ready') {
      setStatus('Served')
      setUpdate('It is your turn. You have been served.')
      return
    }

    const nextPosition = position - 1
    setPosition(nextPosition)

    if (nextPosition <= 1) {
      setStatus('Almost Ready')
      setUpdate(`You moved to #${nextPosition}. You're almost ready!`)
    } else {
      setUpdate(`You moved from position #${position} to #${nextPosition}.`)
    }
  }

  function handleReset() {
    setPosition(queue.position)
    setStatus(queue.position <= 1 ? 'Almost Ready' : 'Waiting')
    setUpdate(null)
  }

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

      {update && (
        <p className={`queue-status-update ${badgeClass[status]}`} role="status">
          {update}
        </p>
      )}

      <div className="queue-status-grid">
        <div className="queue-status-stat card">
          <p className="queue-status-label">Current position</p>
          <p className="queue-status-value">
            {status === 'Served' ? '—' : `#${position}`}
          </p>
        </div>
        <div className="queue-status-stat card">
          <p className="queue-status-label">Estimated wait</p>
          <p className="queue-status-value">{estimatedWait} min</p>
        </div>
        <div className="queue-status-stat card">
          <p className="queue-status-label">Status</p>
          <p className="queue-status-value">
            <span className={`queue-status-badge ${badgeClass[status]}`}>{status}</span>
          </p>
        </div>
      </div>

      <div className="queue-status-progress card">
        <h2>Progress</h2>
        <ol className="queue-status-steps">
          {statusSteps.map((step, index) => {
            const isDone = index < currentStep || status === 'Served'
            let stepState = 'is-upcoming'
            if (isDone) stepState = 'is-complete'
            else if (index === currentStep) stepState = 'is-current'

            return (
              <li
                key={step}
                className={`queue-status-step ${stepState}`}
                aria-current={index === currentStep ? 'step' : undefined}
              >
                <span className="queue-status-dot">
                  {isDone ? '✓' : index + 1}
                </span>
                <span className="queue-status-step-label">{step}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="queue-status-demo">
        <p className="queue-status-demo-label">Demo controls</p>
        <p className="queue-status-demo-text">
          No backend yet. Use these to simulate the line moving.
        </p>
        <div className="queue-status-actions">
          <button
            type="button"
            onClick={handleSimulate}
            disabled={status === 'Served'}
          >
            Simulate Queue Progress
          </button>
          <button type="button" className="button-secondary" onClick={handleReset}>
            Reset
          </button>
        </div>
      </div>

      <div className="queue-status-actions">
        <Link to="/join-queue" className="button button-secondary">
          Back to Join Queue
        </Link>
      </div>
    </section>
  )
}