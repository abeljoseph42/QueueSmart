import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, describeError } from '../../api/client'
import './AdminDashboard.css'

async function loadDashboard() {
  const [metrics, services] = await Promise.allSettled([api('/admin/dashboard'), api('/services')])
  const list = services.status === 'fulfilled' ? services.value : []
  const lengths = Object.fromEntries(await Promise.all(list.map((service) =>
    api(`/admin/services/${encodeURIComponent(service.id)}/queue`).then((queue) => [service.id, queue.length], () => [service.id, null]))))
  return {
    loading: false,
    metrics: metrics.status === 'fulfilled' ? metrics.value : null,
    metricsError: metrics.status === 'rejected' ? describeError(metrics.reason) : '',
    services: list,
    servicesError: services.status === 'rejected' ? describeError(services.reason) : '',
    lengths,
  }
}

export default function AdminDashboard() {
  const [state, setState] = useState({ loading: true, metrics: null, metricsError: '', services: [], servicesError: '', lengths: {} })
  const [notice, setNotice] = useState({ text: '', error: false })
  const [busyId, setBusyId] = useState(null)
  const { loading, metrics, metricsError, services, servicesError, lengths } = state

  useEffect(() => {
    let active = true
    loadDashboard().then((next) => { if (active) setState(next) })
    return () => { active = false }
  }, [])

  async function toggleQueueStatus(service) {
    setBusyId(service.id)
    try {
      const updated = await api(`/admin/services/${encodeURIComponent(service.id)}/queue`, { method: 'PATCH', body: { isOpen: !service.isOpen } })
      setNotice({ text: `${updated.name} queue is now ${updated.isOpen ? 'open' : 'closed'}.`, error: false })
    } catch (error) {
      setNotice({ text: describeError(error), error: true })
    } finally {
      setBusyId(null)
      setState(await loadDashboard())
    }
  }

  const metric = (value) => (loading ? '…' : metrics ? value : '—')

  return (
    <section className="admin-dashboard" aria-labelledby="admin-dashboard-heading">
      <header className="admin-dashboard__header">
        <p className="eyebrow">Administration</p>
        <h1 id="admin-dashboard-heading">Admin Dashboard</h1>
        <p>Monitor service queues and manage the people waiting.</p>
      </header>
      <section className="admin-dashboard__metrics" aria-label="Queue overview" aria-busy={loading}>
        <article className="card admin-dashboard__metric">
          <h2>Active Services</h2>
          <p>{metric(metrics?.openServiceCount)}</p>
        </article>
        <article className="card admin-dashboard__metric">
          <h2>People Waiting</h2>
          <p>{metric(metrics?.waitingCount)}</p>
        </article>
        <article className="card admin-dashboard__metric">
          <h2>Total Services</h2>
          <p>{metric(metrics?.serviceCount)}</p>
        </article>
      </section>
      {metricsError && <p className="field-error admin-dashboard__error" role="alert">{metricsError}</p>}
      <section aria-labelledby="admin-services-heading">
        <h2 id="admin-services-heading">Services</h2>
        {loading && <p className="admin-dashboard__note">Loading services…</p>}
        {servicesError && <p className="field-error admin-dashboard__error" role="alert">Services: {servicesError}</p>}
        {!loading && !servicesError && services.length === 0 && <p className="admin-dashboard__note">No services have been created yet.</p>}
        <div className="admin-dashboard__services">
          {services.map((service) => {
            const status = service.isOpen ? 'OPEN' : 'CLOSED'
            return (
              <article className="card admin-dashboard__service" key={service.id}>
                <div className="admin-dashboard__service-heading">
                  <h3>{service.name}</h3>
                  <span className={`admin-dashboard__status${service.isOpen ? '' : ' admin-dashboard__status--closed'}`} aria-live="polite">{status}</span>
                </div>
                <p className="admin-dashboard__description">{service.description}</p>
                <p className="admin-dashboard__queue-length"><strong>{lengths[service.id] ?? '—'}</strong> people waiting</p>
                <div className="admin-dashboard__actions">
                  <Link className="button" to={`/admin/queues?service=${encodeURIComponent(service.id)}`} aria-label={`Manage queue for ${service.name}`}>Manage Queue</Link>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => toggleQueueStatus(service)}
                    disabled={busyId === service.id}
                    aria-label={`${service.isOpen ? 'Close' : 'Open'} queue for ${service.name}`}
                  >
                    {service.isOpen ? 'Close Queue' : 'Open Queue'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
        <p className={`admin-dashboard__note ${notice.error ? 'field-error' : 'success-message'}`} role="status">{notice.text}</p>
      </section>
    </section>
  )
}
