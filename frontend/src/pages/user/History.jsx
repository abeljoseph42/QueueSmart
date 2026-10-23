import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getHistory } from '../../api/user'
import { listServices } from '../../api/services'
import './History.css'

const outcomeLabels = {
  served: 'Served',
  left: 'Left Queue',
  removed: 'Removed',
}

const filters = [
  { value: 'all', label: 'All' },
  { value: 'served', label: 'Served' },
  { value: 'left', label: 'Left Queue' },
  { value: 'removed', label: 'Removed' },
]

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function waitMinutes(record) {
  return Math.round((new Date(record.endedAt) - new Date(record.joinedAt)) / 60000)
}

export default function History() {
  const [filter, setFilter] = useState('all')
  const [queueHistory, setQueueHistory] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getHistory(), listServices()])
      .then(([records, services]) => {
        if (!active) return
        const names = new Map(services.map((service) => [service.id, service.name]))
        setQueueHistory(
          records.map((record) => ({
            ...record,
            serviceName: names.get(record.serviceId) ?? 'Unknown service',
          })),
        )
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

  const visibleHistory =
    filter === 'all'
      ? queueHistory
      : queueHistory.filter((entry) => entry.outcome === filter)

  return (
    <div className="history">
      <header className="history-header">
        <p className="eyebrow">QueueSmart</p>
        <h1>History</h1>
        <p className="history-intro">Your past visits and how they ended.</p>
      </header>

      <section className="card" aria-labelledby="history-heading">
        <div className="history-toolbar">
          <h2 id="history-heading">Past queues</h2>

          <div
            className="history-filters"
            role="group"
            aria-label="Filter by outcome"
          >
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  filter === option.value
                    ? 'history-filter history-filter-active'
                    : 'button-secondary history-filter'
                }
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <p className="history-empty">Loading your history...</p>
        ) : needsLogin ? (
          <p className="history-empty" role="alert">
            You are not logged in. <Link to="/login">Log in</Link> to see your history.
          </p>
        ) : error ? (
          <p className="history-empty" role="alert">
            {error}
          </p>
        ) : visibleHistory.length === 0 ? (
          <p className="history-empty">
            {filter === 'all'
              ? 'You have no queue history yet.'
              : 'No visits match this filter.'}
          </p>
        ) : (
          <div className="history-table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Service</th>
                  <th scope="col">Wait</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.endedAt)}</td>
                    <td>{entry.serviceName}</td>
                    <td>{waitMinutes(entry)} min</td>
                    <td>
                      <span
                        className={`history-outcome history-outcome-${entry.outcome}`}
                      >
                        {outcomeLabels[entry.outcome]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
