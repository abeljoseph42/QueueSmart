import { useState } from 'react'
import { queueHistory } from './historyData'
import './History.css'

const outcomeLabels = {
  served: 'Served',
  left: 'Left Queue',
}

const filters = [
  { value: 'all', label: 'All' },
  { value: 'served', label: 'Served' },
  { value: 'left', label: 'Left Queue' },
]

function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function History() {
  const [filter, setFilter] = useState('all')

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

        {visibleHistory.length === 0 ? (
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
                    <td>{formatDate(entry.date)}</td>
                    <td>{entry.serviceName}</td>
                    <td>{entry.waitMinutes} min</td>
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
