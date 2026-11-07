import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { apiRequest, clearSession, hasSession } from '../../api/client'

const userLinks = [
  ['/dashboard', 'Dashboard'],
  ['/join-queue', 'Join Queue'],
  ['/queue-status', 'Queue Status'],
  ['/history', 'History'],
  ['/appointments', 'Appointments'],
  ['/notifications', 'Notifications'],
  ['/profile', 'My Profile'],
]

const adminLinks = [
  ['/admin', 'Admin'],
  ['/admin/services', 'Services'],
  ['/admin/queues', 'Manage Queues'],
]

const guestLinks = [
  ['/login', 'Login'],
  ['/register', 'Register'],
]

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [user, setUser] = useState(null)

  useEffect(() => {
    let active = true
    const load = hasSession() ? apiRequest('/auth/me').catch(() => null) : Promise.resolve(null)
    load.then((me) => {
      if (active) setUser(me)
    })
    return () => {
      active = false
    }
  }, [location.pathname])

  function logOut() {
    clearSession()
    setUser(null)
    navigate('/login', { replace: true })
  }

  const links = !user ? guestLinks : user.role === 'admin' ? adminLinks : userLinks

  return (
    <header className="site-header">
      <div className="header-content">
        <Link to={!user ? '/login' : user.role === 'admin' ? '/admin' : '/dashboard'} className="brand">
          QueueSmart
        </Link>
        {user && (
          <span className="demo-label">
            Signed in as {user.name}
            {user.role === 'admin' ? ' (administrator)' : ''}
          </span>
        )}
      </div>

      <nav className="navigation" aria-label="Main navigation">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/admin'}>
            {label}
          </NavLink>
        ))}
        {user && (
          <button type="button" className="button-secondary navigation-logout" onClick={logOut}>
            Log out
          </button>
        )}
      </nav>
    </header>
  )
}
