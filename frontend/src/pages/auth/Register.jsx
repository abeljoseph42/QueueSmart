import { Link } from 'react-router-dom'
import './Login.css'
import './Register.css'

export default function Register() {
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

        <form
          noValidate
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="form-field">
            <label htmlFor="register-email">Email address</label>
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
            />
          </div>

          <div className="form-field">
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="Create a password"
              aria-describedby="register-password-hint"
            />
            <p id="register-password-hint" className="register-hint">
              Use at least 8 characters.
            </p>
          </div>

          <button type="submit" className="auth-submit">
            Create account
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>

        <p className="auth-demo-note">
          Layout preview — registration behavior will be added next.
        </p>
      </div>
    </section>
  )
}