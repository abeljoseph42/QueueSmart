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

  return (
    <section className="join-queue">
      <header className="join-queue-header">
        <p className="eyebrow">Join a Queue</p>
        <h1>Choose a service</h1>
        <p className="join-queue-subtitle">
          Compare wait times and pick the service you need.
        </p>
      </header>

      <div className="join-queue-grid">
        {services.map((service) => {
          const isSelected = service.id === selectedId

          return (
            <button
              key={service.id}
              type="button"
              className={`join-queue-card${isSelected ? ' is-selected' : ''}`}
              onClick={() => setSelectedId(service.id)}
              disabled={!service.isOpen}
              aria-pressed={isSelected}
            >
              <div className="join-queue-card-top">
                <h2>{service.name}</h2>
                <span
                  className={`join-queue-status ${service.isOpen ? 'is-open' : 'is-closed'}`}
                >
                  {service.isOpen ? 'Open' : 'Closed'}
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
                  <dd>{service.peopleWaiting}</dd>
                </div>
              </dl>
            </button>
          )
        })}
      </div>
    </section>
  )
}