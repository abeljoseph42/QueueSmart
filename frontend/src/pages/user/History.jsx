import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMyQueueHistory } from '../../api/queue'
import './History.css'

const outcomeLabels = {
  served: 'Served',
  canceled: 'Canceled',
}

const filters = [
  { value: 'all', label: 'All' },
  { value: 'served', label: 'Served' },
  { value: 'canceled', label: 'Canceled' },
]

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  })
}

function waitMinutes(record) {
  return Math.round((new Date(record.endedAt) - new Date(record.joinedAt)) / 60000)
}

export default function History() {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getMyQueueHistory({ page, outcome: filter === 'all' ? undefined : filter })
      .then((data) => {
        if (!active) return
        setResult(data)
        setNeedsLogin(false)
        setError('')
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
  }, [page, filter])

  function chooseFilter(value) {
    if (value === filter) return
    setIsLoading(true)
    setFilter(value)
    setPage(1)
  }

  function goTo(next) {
    setIsLoading(true)
    setPage(next)
  }

  const items = result?.items ?? []

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
                onClick={() => chooseFilter(option.value)}
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
        ) : items.length === 0 ? (
          <p className="history-empty">
            {filter !== 'all'
              ? 'No visits match this filter.'
              : page === 1
                ? 'You have no queue history yet.'
                : 'There are no visits on this page.'}
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
                {items.map((entry) => (
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

        {result && result.totalPages > 1 && (
          <nav className="history-pages" aria-label="History pages">
            <button
              type="button"
              className="button-secondary"
              onClick={() => goTo(page - 1)}
              disabled={isLoading || page <= 1}
            >
              Newer
            </button>
            <span>
              Page {page} of {result.totalPages}
            </span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => goTo(page + 1)}
              disabled={isLoading || page >= result.totalPages}
            >
              Older
            </button>
          </nav>
        )}
      </section>
    </div>
  )
}