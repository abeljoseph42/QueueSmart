import { Link, NavLink } from 'react-router-dom'

export default function Navbar() {
  return (
    <header className="site-header">
      <div className="header-content">
        <Link to="/login" className="brand">
          QueueSmart
        </Link>
        <span className="demo-label">A2 front-end demo</span>
      </div>

      <nav className="navigation" aria-label="Main navigation">
        <NavLink to="/login">Login</NavLink>
        <NavLink to="/register">Register</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/join-queue">Join Queue</NavLink>
        <NavLink to="/queue-status">Queue Status</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/admin" end>Admin</NavLink>
        <NavLink to="/admin/services">Services</NavLink>
        <NavLink to="/admin/queues">Manage Queues</NavLink>
      </nav>
    </header>
  )
}