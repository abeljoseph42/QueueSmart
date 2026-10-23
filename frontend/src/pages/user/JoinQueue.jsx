import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listServices } from '../../api/services'
import { getMyQueues, joinQueue, leaveQueue, statusLabel } from '../../api/queue'
import './JoinQueue.css'

export default function JoinQueue() {
  const [services, setServices] = useState([])
  const [myQueues, setMyQueues] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [message, setMessage] = useState(null)

  const loadData = useCallback(async () => {
    const list = await listServices()
    let queues = {}
    let loggedOut = false
    try {
      queues = await getMyQueues(list)
    } catch (error) {
      if (error.status !== 401) throw error
      loggedOut = true
    }
    return { list, queues, loggedOut }
  }, [])

  useEffect(() => {
    let active = true
    loadData()
      .then(({ list, queues, loggedOut }) => {
        if (!active) return
        setServices(list)
        setMyQueues(queues)
        setNeedsLogin(loggedOut)
      })
      .catch(error => {
        if (active) setMessage({ type: 'error', text: error.message })
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadData])

  async function refresh() {
    try {
      const { list, queues, loggedOut } = await loadData()
      setServices(list)
      setMyQueues(queues)
      setNeedsLogin(loggedOut)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  const selectedService = services.find(service => service.id === selectedId)
  const myStatus = selectedId ? myQueues[selectedId] : undefined

  function handleSelect(serviceId) {
    setSelectedId(serviceId)
    setMessage(null)
  }

  function handleError(error) {
    if (error.status === 401) {
      setNeedsLogin(true)
      setMessage({ type: 'error', text: 'Please log in to join or leave a queue.' })
      return
    }
    setMessage({ type: 'error', text: error.message })
    
    if (error.status === 409) refresh()
  }

  async function handleJoin() {
    if (!selectedService || isBusy) return
    setIsBusy(true)
    setMessage(null)
    try {
      const status = await joinQueue(selectedService.id)
      setMyQueues(current => ({ ...current, [selectedService.id]: status }))
      setMessage({
        type: 'success',
        text: `You joined ${selectedService.name}. You are #${status.position} with about ${status.estimatedWaitMinutes} min to wait.`,
      })
    } catch (error) {
      handleError(error)
    } finally {
      setIsBusy(false)
    }
  }

  async function handleLeave() {
    if (!selectedService || isBusy) return
    setIsBusy(true)
    setMessage(null)
    try {
      await leaveQueue(selectedService.id)
      setMyQueues(current => {
        const next = { ...current }
        delete next[selectedService.id]
        return next
      })
      setMessage({ type: 'info', text: `You left the ${selectedService.name} queue.` })
    } catch (error) {
      handleError(error)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="join-queue">
      <header className="join-queue-header">
        <p className="eyebrow">Join a Queue</p>
        <h1>Choose a service</h1>
        <p className="join-queue-subtitle">
          Pick the service you need. Your place in line and wait time come from the QueueSmart server.
        </p>
      </header>

      {needsLogin && (
        <p className="join-queue-alert is-info">
          You are not logged in. <Link to="/login">Log in</Link> to join a queue.
        </p>
      )}

      {message && (
        <p className={`join-queue-alert is-${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {isLoading ? (
        <p className="join-queue-hint" role="status">Loading services…</p>
      ) : services.length === 0 ? (
        <p className="join-queue-hint">No services are available yet. An administrator needs to add them.</p>
      ) : (
        <div className="join-queue-grid">
          {services.map(service => {
            const isSelected = service.id === selectedId
            const joined = myQueues[service.id]

            return (
              <button
                key={service.id}
                type="button"
                className={`join-queue-card${isSelected ? ' is-selected' : ''}`}
                onClick={() => handleSelect(service.id)}
                disabled={!service.isOpen && !joined}
                aria-pressed={isSelected}
              >
                <div className="join-queue-card-top">
                  <h2>{service.name}</h2>
                  <span className={`join-queue-status ${service.isOpen ? 'is-open' : 'is-closed'}`}>
                    {joined ? 'Joined' : service.isOpen ? 'Open' : 'Closed'}
                  </span>
                </div>

                <p className="join-queue-description">{service.description}</p>

                <dl className="join-queue-stats">
                  <div>
                    <dt>{joined ? 'Your position' : 'Per person'}</dt>
                    <dd>{joined ? `#${joined.position}` : `${service.expectedDurationMinutes} min`}</dd>
                  </div>
                  <div>
                    <dt>{joined ? 'Estimated wait' : 'Priority'}</dt>
                    <dd className={joined ? undefined : 'join-queue-capitalize'}>
                      {joined ? `${joined.estimatedWaitMinutes} min` : service.priority}
                    </dd>
                  </div>
                </dl>
              </button>
            )
          })}
        </div>
      )}

      {!isLoading && services.length > 0 && (
        <aside className="join-queue-panel card" aria-live="polite">
          {selectedService && myStatus ? (
            <>
              <h2>You&apos;re in line for {selectedService.name}</h2>
              <dl className="join-queue-summary">
                <div>
                  <dt>Your position</dt>
                  <dd>#{myStatus.position}</dd>
                </div>
                <div>
                  <dt>Estimated wait</dt>
                  <dd>{myStatus.estimatedWaitMinutes} min</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel(myStatus.position)}</dd>
                </div>
              </dl>
              <div className="join-queue-actions">
                <Link
                  to={`/queue-status?service=${encodeURIComponent(selectedService.id)}`}
                  className="button"
                >
                  View Queue Status
                </Link>
                <button type="button" className="join-queue-leave" onClick={handleLeave} disabled={isBusy}>
                  {isBusy ? 'Leaving…' : 'Leave Queue'}
                </button>
              </div>
            </>
          ) : selectedService ? (
            <>
              <h2>{selectedService.name}</h2>
              <p className="join-queue-hint">
                Each person takes about {selectedService.expectedDurationMinutes} minutes. You will see your
                exact position and wait time as soon as you join.
              </p>
              <div className="join-queue-actions">
                <button type="button" onClick={handleJoin} disabled={isBusy || !selectedService.isOpen}>
                  {isBusy ? 'Joining…' : 'Join Queue'}
                </button>
                <button type="button" className="button-secondary" onClick={() => setSelectedId(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="join-queue-hint">Select an open service above to join its queue.</p>
          )}
        </aside>
      )}
    </section>
  )
}