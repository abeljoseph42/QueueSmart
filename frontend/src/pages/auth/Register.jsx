import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { validateAuth } from './authValidation'
import { apiRequest } from '../../api/client'
import './Login.css'
import './Register.css'

export default function Register() {
  const navigate = useNavigate()
  
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [apiError, setApiError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()

    if (isSubmitting) return

    const nextErrors = validateAuth({ email, password })

    if (!name.trim()) {
      nextErrors.name = 'Name is required.'
    } else if (name.trim().length > 100) {
      nextErrors.name = 'Name must be 100 characters or fewer.'
    }

    setErrors(nextErrors)
    setApiError('')

    if (Object.keys(nextErrors).length > 0) {
      const firstField = nextErrors.name
        ? 'name'
        : nextErrors.email
          ? 'email'
          : 'password'

      event.currentTarget.elements.namedItem(firstField)?.focus()
      return
    }

    setIsSubmitting(true)

    try {
      const result = await apiRequest('/auth/register', {
        method: 'POST',
        authenticated: false,
        body: {
          name: name.trim(),
          email: email.trim(),
          password,
        },
      })

      navigate('/login', {
        replace: true,
        state: { registeredEmail: result.user.email },
      })
    } catch (error) {
      setApiError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-screen">
      <div className="auth-intro">
        <p className="eyebrow">QueueSmart</p>
        <h1>Join QueueSmart</h1>
        <p>Create an account to join queues and track your place.</p>
      </div>

      <div className="card auth-card">
        <h2>Create an account</h2>
        <p className="auth-description">
          Your email address will be your username.
        </p>

        {apiError && (
          <p className="field-error" role="alert">
            {apiError}
          </p>
        )}

        <form noValidate onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="register-name">Name</label>
            <input
              id="register-name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Your name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={
                errors.name ? 'register-name-error' : undefined
              }
            />

            {errors.name && (
              <p
                id="register-name-error"
                className="field-error"
                role="alert"
              >
                {errors.name}
              </p>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="register-email">Email address</label>
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={
                errors.email ? 'register-email-error' : undefined
              }
            />

            {errors.email && (
              <p
                id="register-email-error"
                className="field-error"
                role="alert"
              >
                {errors.email}
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="Create a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password
                  ? 'register-password-hint register-password-error'
                  : 'register-password-hint'
              }
            />

            <p id="register-password-hint" className="register-hint">
              Use at least 8 characters.
            </p>

            {errors.password && (
              <p
                id="register-password-error"
                className="field-error"
                role="alert"
              >
                {errors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="auth-submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>

      </div>
    </section>
  )
}