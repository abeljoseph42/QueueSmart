import { Link } from 'react-router-dom'
import './AdminDashboard.css'

const services = [
  { id: 'academic-advising', name: 'Academic Advising', description: 'Course selection and academic planning.', queueLength: 7, status: 'OPEN' },
  { id: 'financial-aid', name: 'Financial Aid', description: 'Financial aid and funding questions.', queueLength: 6, status: 'OPEN' },
  { id: 'technical-support', name: 'Technical Support', description: 'Help with accounts, devices, and technology.', queueLength: 5, status: 'OPEN' },
  { id: 'student-services', name: 'Student Services', description: 'General student support and information.', queueLength: 5, status: 'OPEN' },
]

export default function AdminDashboard() {
  return (
    <section className="admin-dashboard" aria-labelledby="admin-dashboard-heading">
      <header className="admin-dashboard__header">
        <p className="eyebrow">Administration</p>
        <h1 id="admin-dashboard-heading">Admin Dashboard</h1>
        <p>Monitor service queues and manage the people waiting.</p>
      </header>
      <section className="admin-dashboard__metrics" aria-label="Queue overview">
        <article className="card admin-dashboard__metric">
          <h2>Active Services</h2>
          <p>{services.filter((service) => service.status === 'OPEN').length}</p>
        </article>
        <article className="card admin-dashboard__metric">
          <h2>People Waiting</h2>
          <p>{services.reduce((total, service) => total + service.queueLength, 0)}</p>
        </article>
        <article className="card admin-dashboard__metric">
          <h2>Average Wait</h2>
          <p>14 <span>min</span></p>
        </article>
      </section>
      <section aria-labelledby="admin-services-heading">
        <h2 id="admin-services-heading">Services</h2>
        <div className="admin-dashboard__services">
          {services.map((service) => (
            <article className="card admin-dashboard__service" key={service.id}>
              <div className="admin-dashboard__service-heading">
                <h3>{service.name}</h3>
                <span className="admin-dashboard__status">{service.status}</span>
              </div>
              <p className="admin-dashboard__description">{service.description}</p>
              <p className="admin-dashboard__queue-length"><strong>{service.queueLength}</strong> people waiting</p>
              <div className="admin-dashboard__actions">
                <Link className="button" to={`/admin/queues?service=${service.id}`} aria-label={`Manage queue for ${service.name}`}>Manage Queue</Link>
                <button type="button" className="button-secondary" disabled>
                  {service.status === 'OPEN' ? 'Close Queue' : 'Open Queue'}
                </button>
              </div>
            </article>
          ))}
        </div>
        <p className="admin-dashboard__note">Queue open and close controls are coming in the next development checkpoint.</p>
      </section>
    </section>
  )
}
