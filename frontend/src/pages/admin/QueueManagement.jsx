import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../../api/client'
import { listServices } from '../../api/services'
import { toFailure } from './adminErrors'
import './QueueManagement.css'

async function loadQueue(requestedId) {
  try {
    const services = await listServices()
    const service = requestedId ? services.find((item) => item.id === requestedId) : services[0]
    if (!service) return { loading: false, error: null, service: null, queue: [], noServices: services.length === 0 }
    const queue = await apiRequest(`/admin/services/${encodeURIComponent(service.id)}/queue`)
    return { loading: false, error: null, service, queue, noServices: false }
  } catch (error) {
    return { loading: false, error: toFailure(error), service: null, queue: [], noServices: false }
  }
}

export default function QueueManagement() {
  const [searchParams] = useSearchParams()
  const requestedId = searchParams.get('service')
  const [state, setState] = useState({ loading: true, error: null, service: null, queue: [], noServices: false })
  const [notice, setNotice] = useState({ text: '', error: false, login: false })
  const [busy, setBusy] = useState(false)
  const { loading, error, service, queue, noServices } = state

  useEffect(() => {
    let active = true
    loadQueue(requestedId).then((next) => { if (active) setState(next) })
    return () => { active = false }
  }, [requestedId])

  async function run(action, describeSuccess) {
    setBusy(true)
    try {
      setNotice({ text: describeSuccess(await action()), error: false, login: false })
    } catch (actionError) {
      setNotice({ ...toFailure(actionError), error: true })
    } finally {
      setState(await loadQueue(requestedId))
      setBusy(false)
    }
  }

  const nameOf = (item) => item && (item.userName ?? item.entry.userId)
  const queuePath = (suffix = '') => `/admin/services/${encodeURIComponent(service.id)}/queue${suffix}`
  const entryPath = (entryId) => queuePath(`/${encodeURIComponent(entryId)}`)

  const toggleOpen = () => run(() => apiRequest(queuePath(), { method: 'PATCH', body: { isOpen: !service.isOpen } }),
    (updated) => `Queue is now ${updated.isOpen ? 'open' : 'closed'}.`)
  const serveNext = () => run(() => apiRequest(queuePath('/serve-next'), { method: 'POST' }),
    ({ entry }) => `${nameOf(queue.find((item) => item.entry.id === entry.id)) ?? entry.userId} has been served.`)
  const removeEntry = (item) => run(() => apiRequest(entryPath(item.entry.id), { method: 'DELETE' }),
    () => `${nameOf(item)} has been removed from the queue.`)
  const changePriority = (item, priority) => run(() => apiRequest(entryPath(item.entry.id), { method: 'PATCH', body: { priority } }),
    () => `${nameOf(item)} priority set to ${priority}.`)

  if (loading) {
    return <section className="card queue-management" aria-busy="true"><p>Loading queue…</p></section>
  }

  if (error || !service) {
    return (
      <section className="card queue-management">
        <h1>{error ? 'Queue unavailable' : 'Service not found'}</h1>
        {error
          ? <p className="field-error" role="alert">{error.text}{error.login && <> <Link to="/login">Log in</Link></>}</p>
          : <p>{noServices ? 'No services have been created yet.' : 'Select a service from the admin dashboard to view its queue.'}</p>}
        <Link to="/admin" className="button">Back to Admin Dashboard</Link>
      </section>
    )
  }

  return (
    <section className="queue-management" aria-labelledby="queue-management-heading">
      <Link to="/admin">← Back to Admin Dashboard</Link>
      <header className="queue-management__header">
        <p className="eyebrow">Administration</p>
        <h1 id="queue-management-heading">Queue Management</h1>
        <h2>{service.name}</h2>
        <p>{service.description}</p>
      </header>
      <div className="card">
        <div className="queue-management__summary">
          <h3>Waiting list <span>({queue.length})</span> <span>· {service.isOpen ? 'Open' : 'Closed'}</span></h3>
          <div className="queue-management__actions">
            <button type="button" className="button-secondary" onClick={toggleOpen} disabled={busy}>{service.isOpen ? 'Close Queue' : 'Open Queue'}</button>
            <button type="button" onClick={serveNext} disabled={busy || queue.length === 0}>Serve Next</button>
          </div>
        </div>
        <div className="queue-management__table-wrapper" role="region" aria-label={`${service.name} waiting list`} tabIndex={0}>
          <table>
            <caption>{service.name} — waiting list</caption>
            <thead>
              <tr>
                <th scope="col">Position</th>
                <th scope="col">User</th>
                <th scope="col">Priority</th>
                <th scope="col">Estimated Wait</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => {
                const { entry, position, estimatedWaitMinutes } = item
                const name = nameOf(item)
                return (
                  <tr key={entry.id}>
                    <td>{position}</td>
                    <th scope="row">{name}</th>
                    <td>
                      <select value={entry.priority} onChange={(event) => changePriority(item, event.target.value)} disabled={busy} aria-label={`Priority for ${name}`}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </td>
                    <td>{estimatedWaitMinutes} minutes</td>
                    <td>
                      <div className="queue-management__actions">
                        <button type="button" className="button-secondary" onClick={() => removeEntry(item)} disabled={busy} aria-label={`Remove ${name}`}>Remove</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {queue.length === 0 && (
                <tr><td colSpan={5} className="queue-management__empty">No one is waiting in this queue.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={`queue-management__message ${notice.error ? 'field-error' : 'success-message'}`} role="status">{notice.text}{notice.login && <> <Link to="/login">Log in</Link></>}</p>
      </div>
    </section>
  )
}