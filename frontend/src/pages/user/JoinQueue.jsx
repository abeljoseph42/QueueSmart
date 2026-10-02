import { useState } from 'react'
import './JoinQueue.css'

// TODO: move to src/data/services.js once the team agrees on the shared shape
const services = [
  {
    id: 'academic-advising',
    name: 'Academic Advising',
    description: 'Degree plans, course selection, and registration help.',
    estimatedWait: 15,
    peopleWaiting: 6,
    isOpen: true,
  },
  {
    id: 'it-support',
    name: 'IT Support',
    description: 'Password resets, Wi-Fi access, and account issues.',
    estimatedWait: 8,
    peopleWaiting: 3,
    isOpen: true,
  },
  {
    id: 'financial-aid',
    name: 'Financial Aid',
    description: 'Scholarships, grants, loans, and FAFSA questions.',
    estimatedWait: 20,
    peopleWaiting: 9,
    isOpen: true,
  },
  {
    id: 'student-services',
    name: 'Student Services',
    description: 'ID cards, enrollment verification, and parking permits.',
    estimatedWait: 12,
    peopleWaiting: 5,
    isOpen: false,
  },
]

export default function JoinQueue() {
  const [selectedId, setSelectedId] = useState(null)
  // The service the user is currently waiting in (null = not in any queue).
  const [joinedId, setJoinedId] = useState(null)
  const [message, setMessage] = useState(null)

  const selectedService = services.find((service) => service.id === selectedId)
  const joinedService = services.find((service) => service.id === joinedId)

  // Joining puts you at the back of the line.
  const yourPosition = joinedService ? joinedService.peopleWaiting + 1 : null

  function handleSelect(serviceId) {
    setSelectedId(serviceId)
    setMessage(null)
  }

  function handleJoin() {
    if (!selectedService) return
    setJoinedId(selectedService.id)
    setMessage({ type: 'success', text: `You joined ${selectedService.name}.` })
  }

  function handleLeave() {
    if (!joinedService) return
    setMessage({ type: 'info', text: `You left the ${joinedService.name} queue.` })
    setJoinedId(null)
    setSelectedId(null)
  }

  return (
    <section className="join-queue">
      <header className="join-queue-header">
        <p className="eyebrow">Join a Queue</p>
        <h1>Choose a service</h1>
        <p className="join-queue-subtitle">
          Compare wait times and pick the service you need.
        </p>
      </header>

      {message && (
        <p
          className={`join-queue-alert is-${message.type}`}
          role="status"
        >
          {message.text}
        </p>
      )}

      <div className="join-queue-grid">
        {services.map((service) => {
          const isSelected = service.id === selectedId
          const isJoined = service.id === joinedId
          // While in a queue, the other cards are locked.
          const isLocked = joinedId !== null && !isJoined

          return (
            <button
              key={service.id}
              type="button"
              className={`join-queue-card${isSelected ? ' is-selected' : ''}`}
              onClick={() => handleSelect(service.id)}
              disabled={!service.isOpen || isLocked}
              aria-pressed={isSelected}
            >
              <div className="join-queue-card-top">
                <h2>{service.name}</h2>
                <span
                  className={`join-queue-status ${service.isOpen ? 'is-open' : 'is-closed'}`}
                >
                  {isJoined ? 'Joined' : service.isOpen ? 'Open' : 'Closed'}
                </span>
              </div>

              <p className="join-queue-description">{service.description}</p>

              <dl className="join-queue-stats">
                <div>
                  <dt>Estimated wait</dt>
                  <dd>{service.estimatedWait} min</dd>
                </div>
                <div>
                  <dt>People waiting</dt>
                  <dd>{isJoined ? service.peopleWaiting + 1 : service.peopleWaiting}</dd>
                </div>
              </dl>
            </button>
          )
        })}
      </div>

      <aside className="join-queue-panel card" aria-live="polite">
        {joinedService ? (
          <>
            <h2>You&apos;re in line for {joinedService.name}</h2>
            <dl className="join-queue-summary">
              <div>
                <dt>Your position</dt>
                <dd>#{yourPosition}</dd>
              </div>
              <div>
                <dt>Estimated wait</dt>
                <dd>{joinedService.estimatedWait} min</dd>
              </div>
            </dl>
            <p className="join-queue-hint">
              Leave this queue to join a different service.
            </p>
            <div className="join-queue-actions">
              <button type="button" className="join-queue-leave" onClick={handleLeave}>
                Leave Queue
              </button>
            </div>
          </>
        ) : selectedService ? (
          <>
            <h2>{selectedService.name}</h2>
            <dl className="join-queue-summary">
              <div>
                <dt>Estimated wait</dt>
                <dd>{selectedService.estimatedWait} min</dd>
              </div>
              <div>
                <dt>People ahead of you</dt>
                <dd>{selectedService.peopleWaiting}</dd>
              </div>
            </dl>
            <div className="join-queue-actions">
              <button type="button" onClick={handleJoin}>
                Join Queue
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setSelectedId(null)}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p className="join-queue-hint">
            Select an open service above to see its wait time and join the queue.
          </p>
        )}
      </aside>
    </section>
  )
}