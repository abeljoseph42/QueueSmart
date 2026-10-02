import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { validateAuth } from './authValidation'
import './Login.css'
import './Register.css'

export default function Register() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})

  function handleSubmit(event) {
    event.preventDefault()

    const nextErrors = validateAuth({ email, password })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      const firstField = nextErrors.email ? 'email' : 'password'
      event.currentTarget.elements.namedItem(firstField)?.focus()
      return
    }

    navigate('/login', {
      replace: true,
      state: { registeredEmail: email.trim() },
    })
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

        <form noValidate onSubmit={handleSubmit}>
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

          <button type="submit" className="auth-submit">
            Create account
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>

        <p className="auth-demo-note">
          Demo only. This form checks your inputs and returns you to Login.
          No account is created and no password is stored.
        </p>
      </div>
    </section>
  )
}