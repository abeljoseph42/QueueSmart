import { useRef, useState } from 'react'
import { validateService } from './serviceValidation'
import './ServiceManagement.css'

const initialServices = [
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

const emptyForm = {
  name: '',
  description: '',
  expectedDuration: '',
  priority: 'medium',
}

function FieldError({ id, message }) {
  if (!message) return null

  return (
    <p id={id} className="field-error" role="alert">
      {message}
    </p>
  )
}

export default function ServiceManagement() {
  const [services, setServices] = useState(initialServices)
  const [form, setForm] = useState({ ...emptyForm })
  const [editingId, setEditingId] = useState(null)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const nameInputRef = useRef(null)

  const isEditing = editingId !== null

  function handleChange(event) {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))

    setMessage('')
  }

  function handleSubmit(event) {
    event.preventDefault()

    const nextErrors = validateService(form)
    setErrors(nextErrors)
    setMessage('')

    if (Object.keys(nextErrors).length > 0) {
      const firstField = Object.keys(nextErrors)[0]
      event.currentTarget.elements.namedItem(firstField)?.focus()
      return
    }

    const serviceDetails = {
      name: form.name.trim(),
      description: form.description.trim(),
      expectedDuration: Number(form.expectedDuration),
      priority: form.priority,
    }

    if (isEditing) {
      setServices((current) =>
        current.map((service) =>
          service.id === editingId
            ? { ...service, ...serviceDetails }
            : service,
        ),
      )

      setMessage(`${serviceDetails.name} was updated successfully.`)
    } else {
      const newService = {
        id: crypto.randomUUID(),
        ...serviceDetails,
      }

      setServices((current) => [...current, newService])
      setMessage(`${serviceDetails.name} was created successfully.`)
    }

    setForm({ ...emptyForm })
    setEditingId(null)
    setErrors({})
    nameInputRef.current?.focus()
  }

  function handleEdit(service) {
    setEditingId(service.id)

    setForm({
      name: service.name,
      description: service.description,
      expectedDuration: String(service.expectedDuration),
      priority: service.priority,
    })

    setErrors({})
    setMessage('')
    nameInputRef.current?.focus()
  }

  function handleCancelEdit() {
    setForm({ ...emptyForm })
    setEditingId(null)
    setErrors({})
    setMessage('Editing canceled. No changes were saved.')
    nameInputRef.current?.focus()
  }

  return (
    <section className="service-management">
      <header className="service-page-header">
        <p className="eyebrow">Administration</p>
        <h1>Service Management</h1>
        <p>Create and update the services available in QueueSmart.</p>
      </header>

      <p className="service-demo-note">
        Demo services are stored for this page session. Refreshing restores
        the original list.
      </p>

      <div className="service-management-grid">
        <section className="card" aria-labelledby="service-form-heading">
          <h2 id="service-form-heading">
            {isEditing ? 'Edit service' : 'Create a service'}
          </h2>

          <p className="service-description">
            {isEditing
              ? 'Update the details, then save your changes.'
              : 'Enter the service details below.'}
          </p>

          {message && (
            <p className="service-feedback" role="status">
              {message}
            </p>
          )}

          <form noValidate onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="service-name">Service name</label>
              <input
                ref={nameInputRef}
                id="service-name"
                name="name"
                type="text"
                placeholder="Example: Academic Advising"
                value={form.name}
                onChange={handleChange}
                required
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name
                    ? 'service-name-hint service-name-error'
                    : 'service-name-hint'
                }
              />

              <p id="service-name-hint" className="service-field-hint">
                Required. Maximum 100 characters.
              </p>

              <FieldError
                id="service-name-error"
                message={errors.name}
              />
            </div>

            <div className="form-field">
              <label htmlFor="service-description">Description</label>
              <textarea
                id="service-description"
                name="description"
                placeholder="Describe what this service provides."
                value={form.description}
                onChange={handleChange}
                required
                aria-invalid={Boolean(errors.description)}
                aria-describedby={
                  errors.description
                    ? 'service-description-hint service-description-error'
                    : 'service-description-hint'
                }
              />

              <p
                id="service-description-hint"
                className="service-field-hint"
              >
                Required.
              </p>

              <FieldError
                id="service-description-error"
                message={errors.description}
              />
            </div>

            <div className="form-field">
              <label htmlFor="service-duration">
                Expected duration (minutes)
              </label>
              <input
                id="service-duration"
                name="expectedDuration"
                type="number"
                min="1"
                step="1"
                placeholder="15"
                value={form.expectedDuration}
                onChange={handleChange}
                required
                aria-invalid={Boolean(errors.expectedDuration)}
                aria-describedby={
                  errors.expectedDuration
                    ? 'service-duration-hint service-duration-error'
                    : 'service-duration-hint'
                }
              />

              <p id="service-duration-hint" className="service-field-hint">
                Required. Enter a positive whole number of minutes.
              </p>

              <FieldError
                id="service-duration-error"
                message={errors.expectedDuration}
              />
            </div>

            <div className="form-field">
              <label htmlFor="service-priority">Priority level</label>
              <select
                id="service-priority"
                name="priority"
                value={form.priority}
                onChange={handleChange}
                aria-invalid={Boolean(errors.priority)}
                aria-describedby={
                  errors.priority ? 'service-priority-error' : undefined
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>

              <FieldError
                id="service-priority-error"
                message={errors.priority}
              />
            </div>

            <div className="service-form-actions">
              <button type="submit">
                {isEditing ? 'Save changes' : 'Create service'}
              </button>

              {isEditing && (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleCancelEdit}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </section>

        <section
          className="service-list-section"
          aria-labelledby="service-list-heading"
        >
          <div className="service-list-header">
            <h2 id="service-list-heading">Existing services</h2>
            <span className="service-count">
              {services.length} services
            </span>
          </div>

          <ul className="service-list">
            {services.map((service) => (
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
                    onClick={() => handleEdit(service)}
                    disabled={isEditing}
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