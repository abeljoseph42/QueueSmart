import { Link } from 'react-router-dom'
import './Login.css'

export default function Login() {
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

        <form
          noValidate
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="form-field">
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
            />
          </div>

          <div className="form-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
            />
          </div>

          <button type="submit" className="auth-submit">
            Log in
          </button>
        </form>

        <p className="auth-switch">
          New to QueueSmart? <Link to="/register">Create an account</Link>
        </p>

        <p className="auth-demo-note">
          Layout preview — sign-in behavior will be added next.
        </p>
      </div>
    </section>
  )
}