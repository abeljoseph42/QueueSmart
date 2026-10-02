import './ServiceManagement.css'

const mockServices = [
  {
    id: 'academic-advising',
    name: 'Academic Advising',
    description: 'Get help with course selection and academic planning.',
    expectedDuration: 15,
    priority: 'medium',
  },
  {
    id: 'financial-aid',
    name: 'Financial Aid',
    description: 'Ask questions about financial aid and scholarships.',
    expectedDuration: 20,
    priority: 'high',
  },
  {
    id: 'technical-support',
    name: 'Technical Support',
    description: 'Get assistance with accounts, devices, and software.',
    expectedDuration: 10,
    priority: 'medium',
  },
  {
    id: 'student-services',
    name: 'Student Services',
    description: 'Get assistance with general student inquiries.',
    expectedDuration: 10,
    priority: 'low',
  },
]

export default function ServiceManagement() {
  return (
    <section className="service-management">
      <header className="service-page-header">
        <p className="eyebrow">Administration</p>
        <h1>Service Management</h1>
        <p>Create and update the services available in QueueSmart.</p>
      </header>

      <div className="service-management-grid">
        <section className="card" aria-labelledby="service-form-heading">
          <h2 id="service-form-heading">Create a service</h2>
          <p className="service-description">
            Enter the service details below.
          </p>

          <form
            noValidate
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="form-field">
              <label htmlFor="service-name">Service name</label>
              <input
                id="service-name"
                name="name"
                type="text"
                placeholder="Example: Academic Advising"
                aria-describedby="service-name-hint"
              />
              <p id="service-name-hint" className="service-field-hint">
                Required. Maximum 100 characters.
              </p>
            </div>

            <div className="form-field">
              <label htmlFor="service-description">Description</label>
              <textarea
                id="service-description"
                name="description"
                placeholder="Describe what this service provides."
                aria-describedby="service-description-hint"
              />
              <p
                id="service-description-hint"
                className="service-field-hint"
              >
                Required.
              </p>
            </div>

            <div className="form-field">
              <label htmlFor="service-duration">
                Expected duration (minutes)
              </label>
              <input
                id="service-duration"
                name="expectedDuration"
                type="number"
                placeholder="15"
                aria-describedby="service-duration-hint"
              />
              <p id="service-duration-hint" className="service-field-hint">
                Required. Enter the estimated time to serve one person.
              </p>
            </div>

            <div className="form-field">
              <label htmlFor="service-priority">Priority level</label>
              <select
                id="service-priority"
                name="priority"
                defaultValue="medium"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <button type="submit" disabled>
              Create service
            </button>

            <p className="service-preview-note">
              Layout preview. Creating and editing will be added next.
            </p>
          </form>
        </section>

        <section
          className="service-list-section"
          aria-labelledby="service-list-heading"
        >
          <div className="service-list-header">
            <h2 id="service-list-heading">Existing services</h2>
            <span className="service-count">
              {mockServices.length} services
            </span>
          </div>

          <ul className="service-list">
            {mockServices.map((service) => (
              <li key={service.id} className="card service-item">
                <div className="service-item-header">
                  <h3>{service.name}</h3>
                  <span
                    className={`service-priority service-priority-${service.priority}`}
                  >
                    {service.priority} priority
                  </span>
                </div>

                <p className="service-description">
                  {service.description}
                </p>

                <div className="service-item-footer">
                  <span>
                    Expected duration: {service.expectedDuration} min
                  </span>

                  <button
                    type="button"
                    className="button-secondary"
                    aria-label={`Edit ${service.name}`}
                    disabled
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}