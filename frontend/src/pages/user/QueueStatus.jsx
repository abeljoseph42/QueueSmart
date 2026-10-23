import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listServices } from '../../api/services'
import { getMyQueues, leaveQueue, statusLabel } from '../../api/queue'
import './QueueStatus.css'

const statusSteps = ['Joined', 'Waiting', 'Almost Ready', 'Served']
const badgeClass = { Waiting: 'is-waiting', 'Almost Ready': 'is-almost', Served: 'is-served' }
const REFRESH_MS = 10000

export default function QueueStatus() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = searchParams.get('service')

  const [services, setServices] = useState([])
  const [myQueues, setMyQueues] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const previousQueues = useRef({})

  const loadData = useCallback(async () => {
    const list = await listServices()
    const queues = await getMyQueues(list)
    return { list, queues }
  }, [])

  
  const apply = useCallback(({ list, queues }) => {
    const previous = previousQueues.current
    const watched = requestedId || Object.keys(previous)[0]
    if (watched && previous[watched] && !queues[watched]) {
      const name = list.find(s => s.id === watched)?.name || 'this service'
      setNotice(`You are no longer waiting for ${name}. You were served, left, or were removed. Check your History for the outcome.`)
    }
    previousQueues.current = queues
    setServices(list)
    setMyQueues(queues)
    setNeedsLogin(false)
    setError('')
    setLastUpdated(new Date())
  }, [requestedId])

  const handleFailure = useCallback(err => {
    if (err.status === 401) setNeedsLogin(true)
    else setError(err.message)
  }, [])

  useEffect(() => {
    let active = true
    const run = () => loadData()
      .then(data => { if (active) apply(data) })
      .catch(err => { if (active) handleFailure(err) })
      .finally(() => { if (active) setIsLoading(false) })
    run()
    const timer = setInterval(run, REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [loadData, apply, handleFailure])

  async function refresh() {
    try {
      apply(await loadData())
    } catch (err) {
      handleFailure(err)
    }
  }

  const activeIds = Object.keys(myQueues)
  const currentId = requestedId && myQueues[requestedId] ? requestedId : activeIds[0]
  const current = currentId ? myQueues[currentId] : null
  const service = services.find(s => s.id === currentId)
  const status = current ? statusLabel(current.position) : null
  const currentStep = status ? statusSteps.indexOf(status) : -1

  async function handleLeave() {
    if (!currentId || isBusy) return
    setIsBusy(true)
    try {
      await leaveQueue(currentId)
      const next = { ...myQueues }
      delete next[currentId]
      previousQueues.current = next
      setMyQueues(next)
      setNotice(`You left the ${service?.name || ''} queue.`)
      setSearchParams({})
    } catch (err) {
      handleFailure(err)
    } finally {
      setIsBusy(false)
    }
  }

  if (isLoading) {
    return (
      <section className="queue-status">
        <p className="queue-status-subtitle" role="status">Loading your queue status…</p>
      </section>
    )
  }

  return (
    <section className="queue-status">
      <header className="queue-status-header">
        <p className="eyebrow">Queue Status</p>
        <h1>{service ? service.name : 'Your queues'}</h1>
        <p className="queue-status-subtitle">
          {lastUpdated
            ? `Updates automatically every ${REFRESH_MS / 1000} seconds. Last updated ${lastUpdated.toLocaleTimeString()}.`
            : 'Live status from the QueueSmart server.'}
        </p>
      </header>

      {needsLogin && (
        <p className="queue-status-update is-error" role="alert">
          You are not logged in. <Link to="/login">Log in</Link> to see your queue status.
        </p>
      )}
      {error && <p className="queue-status-update is-error" role="alert">{error}</p>}
      {notice && <p className="queue-status-update is-almost" role="status">{notice}</p>}

      {activeIds.length > 1 && (
        <div className="queue-status-actions queue-status-tabs" role="group" aria-label="Your queues">
          {activeIds.map(id => (
            <button
              key={id}
              type="button"
              className={id === currentId ? '' : 'button-secondary'}
              aria-pressed={id === currentId}
              onClick={() => setSearchParams({ service: id })}
            >
              {services.find(s => s.id === id)?.name || 'Queue'}
            </button>
          ))}
        </div>
      )}

      {current ? (
        <>
          {status === 'Almost Ready' && (
            <p className="queue-status-update is-almost" role="status">
              You&apos;re almost ready! Please stay nearby.
            </p>
          )}

          <div className="queue-status-grid">
            <div className="queue-status-stat card">
              <p className="queue-status-label">Current position</p>
              <p className="queue-status-value">#{current.position}</p>
            </div>
            <div className="queue-status-stat card">
              <p className="queue-status-label">Estimated wait</p>
              <p className="queue-status-value">{current.estimatedWaitMinutes} min</p>
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
                let stepState = 'is-upcoming'
                if (index < currentStep) stepState = 'is-complete'
                else if (index === currentStep) stepState = 'is-current'
                return (
                  <li
                    key={step}
                    className={`queue-status-step ${stepState}`}
                    aria-current={index === currentStep ? 'step' : undefined}
                  >
                    <span className="queue-status-dot">{index < currentStep ? '✓' : index + 1}</span>
                    <span className="queue-status-step-label">{step}</span>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="queue-status-actions">
            <button type="button" className="button-secondary" onClick={refresh}>Refresh</button>
            <button type="button" className="queue-status-leave" onClick={handleLeave} disabled={isBusy}>
              {isBusy ? 'Leaving…' : 'Leave Queue'}
            </button>
            <Link to="/join-queue" className="button button-secondary">Back to Join Queue</Link>
          </div>
        </>
      ) : (
        !needsLogin && (
          <div className="card queue-status-empty">
            <h2>You&apos;re not waiting in any queue</h2>
            <p className="queue-status-subtitle">Join a queue to see your position and estimated wait here.</p>
            <div className="queue-status-actions">
              <Link to="/join-queue" className="button">Join a Queue</Link>
              <Link to="/history" className="button button-secondary">View History</Link>
            </div>
          </div>
        )
      )}
    </section>
  )
}