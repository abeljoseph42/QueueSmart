import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { validateAuth } from './authValidation'
import './Login.css'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const registeredEmail = location.state?.registeredEmail ?? ''

  const [email, setEmail] = useState(registeredEmail)
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

    navigate('/dashboard', {
        replace: true,
    })
  }

  return (
    <section className="auth-screen">
      <div className="auth-intro">
        <p className="eyebrow">QueueSmart</p>
        <h1>Welcome back</h1>
        <p>Sign in to manage your queues and follow your progress.</p>
      </div>

      <div className="card auth-card">
        <h2>Log in</h2>
        <p className="auth-description">
          Enter your email address and password.
        </p>

        {registeredEmail && (
          <p className="auth-success" role="status">
            Registration complete. Please log in.
          </p>
        )}

        <form noValidate onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
            />

            {errors.email && (
              <p
                id="login-email-error"
                className="field-error"
                role="alert"
              >
                {errors.email}
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password ? 'login-password-error' : undefined
              }
            />

            {errors.password && (
              <p
                id="login-password-error"
                className="field-error"
                role="alert"
              >
                {errors.password}
              </p>
            )}
          </div>

          <button type="submit" className="auth-submit">
            Log in
          </button>
        </form>

        <p className="auth-switch">
          New to QueueSmart? <Link to="/register">Create an account</Link>
        </p>

      </div>
    </section>
  )
}