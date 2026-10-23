import { useEffect, useRef, useState } from 'react'
import {
  listServices,
  createService,
  updateService,
} from '../../api/services'
import { validateService } from './serviceValidation'
import './ServiceManagement.css'

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
  const [services, setServices] = useState([])
  const [form, setForm] = useState({ ...emptyForm })
  const [editingId, setEditingId] = useState(null)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [apiError, setApiError] = useState('')
  const nameInputRef = useRef(null)

  const isEditing = editingId !== null

    useEffect(() => {
    let active = true

    listServices()
      .then(data => {
        if (active) {
          setServices(data)
        }
      })
      .catch(error => {
        if (active) {
          setApiError(error.message)
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  function handleChange(event) {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))

    setMessage('')
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (isSubmitting || isLoading) return

    const nextErrors = validateService(form)

    setErrors(nextErrors)
    setMessage('')
    setApiError('')

    if (Object.keys(nextErrors).length > 0) {
      const firstField = Object.keys(nextErrors)[0]
      event.currentTarget.elements.namedItem(firstField)?.focus()
      return
    }

    setIsSubmitting(true)

    try {
      if (isEditing) {
        const updated = await updateService(editingId, form)

        setServices(current =>
          current.map(service =>
            service.id === updated.id ? updated : service,
          ),
        )

        setMessage(`${updated.name} was updated successfully.`)
      } else {
        const created = await createService(form)

        setServices(current => [...current, created])

        setMessage(`${created.name} was created successfully.`)
      }

      setForm({ ...emptyForm })
      setEditingId(null)
      setErrors({})
    } catch (error) {
      const message =
        error.status === 401
          ? 'Please log in again before managing services.'
          : error.status === 403
            ? 'Only administrators can manage services.'
            : error.message

      setApiError(message)
    } finally {
      setIsSubmitting(false)
    }
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

          {isLoading && (
            <p role="status">Loading services…</p>
          )}

          {apiError && (
            <p className="field-error" role="alert">
              {apiError}
            </p>
          )}

          <form noValidate onSubmit={handleSubmit}>
            <fieldset
              disabled={isLoading || isSubmitting}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                minWidth: 0,
              }}
            >
            <div className="form-field">
              <label htmlFor="service-name"> Service name <span className="service-required" aria-hidden="true">*</span></label>
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
                Maximum 100 characters.
              </p>

              <FieldError
                id="service-name-error"
                message={errors.name}
              />
            </div>

            <div className="form-field">
              <label htmlFor="service-description">Description <span className="service-required" aria-hidden="true">*</span></label>
              <textarea
                id="service-description"
                name="description"
                placeholder="Describe what this service provides."
                value={form.description}
                onChange={handleChange}
                required
                aria-invalid={Boolean(errors.description)}
                aria-describedby={
                    errors.description ? 'service-description-error' : 
                    undefined
                }
              />

              <FieldError
                id="service-description-error"
                message={errors.description}
              />
            </div>

            <div className="form-field">
              <label htmlFor="service-duration">Expected duration (minutes){' '}<span className="service-required" aria-hidden="true">*</span></label>
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
                    errors.expectedDuration ? 'service-duration-error' : 
                    undefined
                }
              />

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
                {isSubmitting
                  ? 'Saving…'
                  : isEditing
                    ? 'Save changes'
                    : 'Create service'}
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
            </fieldset>
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

          {!isLoading && !apiError && services.length === 0 && (
            <p>No services are available yet. Create your first service.</p>
          )}

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
                    disabled={isEditing || isSubmitting || isLoading}
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