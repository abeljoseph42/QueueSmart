import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import './QueueManagement.css'

const serviceNames = {
  'academic-advising': 'Academic Advising',
  'financial-aid': 'Financial Aid',
  'technical-support': 'Technical Support',
  'student-services': 'Student Services',
}

const academicQueue = [
  { id: 1, name: 'Sarah Johnson', waitTime: 14 },
  { id: 2, name: 'Mike Smith', waitTime: 10 },
  { id: 3, name: 'John Davis', waitTime: 7 },
  { id: 4, name: 'Emily Brown', waitTime: 4 },
]

export default function QueueManagement() {
  const [searchParams] = useSearchParams()
  const serviceId = searchParams.get('service') ?? 'academic-advising'
  const serviceName = Object.hasOwn(serviceNames, serviceId) ? serviceNames[serviceId] : null
  const [queues, setQueues] = useState({
    'academic-advising': { users: academicQueue, message: '' },
  })
  const queueState = queues[serviceId] ?? { users: [], message: '' }
  const queue = queueState.users

  function moveUser(userId, direction) {
    setQueues((current) => {
      const state = current[serviceId]
      if (!state) return current
      const index = state.users.findIndex((user) => user.id === userId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= state.users.length) return current
      const users = [...state.users]
      ;[users[index], users[nextIndex]] = [users[nextIndex], users[index]]
      return {
        ...current,
        [serviceId]: { users, message: `${users[nextIndex].name} moved to position ${nextIndex + 1}.` },
      }
    })
  }

  function removeUser(userId) {
    setQueues((current) => {
      const state = current[serviceId]
      const user = state?.users.find((entry) => entry.id === userId)
      if (!user) return current
      return {
        ...current,
        [serviceId]: {
          users: state.users.filter((entry) => entry.id !== userId),
          message: `${user.name} has been removed from the queue.`,
        },
      }
    })
  }

  function serveNext() {
    setQueues((current) => {
      const state = current[serviceId]
      if (!state?.users.length) return current
      return {
        ...current,
        [serviceId]: {
          users: state.users.slice(1),
          message: `${state.users[0].name} has been served.`,
        },
      }
    })
  }

  if (!serviceName) {
    return (
      <section className="card queue-management">
        <h1>Service not found</h1>
        <p>Select a service from the admin dashboard to view its queue.</p>
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
        <h2>{serviceName}</h2>
        <p>Sample queue preview for the selected service. Dashboard totals are separate mock summaries.</p>
      </header>
      <div className="card">
        <div className="queue-management__summary">
          <h3>Waiting list <span>({queue.length})</span></h3>
          <button type="button" onClick={serveNext} disabled={queue.length === 0}>Serve Next</button>
        </div>
        <div className="queue-management__table-wrapper" role="region" aria-label={`${serviceName} waiting list`} tabIndex={0}>
          <table>
            <caption>{serviceName} — sample waiting list</caption>
            <thead>
              <tr>
                <th scope="col">Position</th>
                <th scope="col">User</th>
                <th scope="col">Time Waiting</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((user, index) => (
                <tr key={user.id}>
                  <td>{index + 1}</td>
                  <th scope="row">{user.name}</th>
                  <td>{user.waitTime} minutes</td>
                  <td>
                    <div className="queue-management__actions">
                      <button type="button" className="button-secondary" onClick={() => moveUser(user.id, -1)} disabled={index === 0} aria-label={`Move ${user.name} up`}>Move Up</button>
                      <button type="button" className="button-secondary" onClick={() => moveUser(user.id, 1)} disabled={index === queue.length - 1} aria-label={`Move ${user.name} down`}>Move Down</button>
                      <button type="button" className="button-secondary" onClick={() => removeUser(user.id)} aria-label={`Remove ${user.name}`}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
              {queue.length === 0 && (
                <tr><td colSpan={4} className="queue-management__empty">{serviceId === 'academic-advising' ? 'No one is waiting in this queue.' : 'No sample users have been added for this service.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="queue-management__message success-message" role="status">{queueState.message}</p>
        <p className="queue-management__note">These actions are simulated. Reloading the page resets the sample queues.</p>
      </div>
    </section>
  )
}
