import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import { authRoutes } from './routes/authRoutes'
import { userRoutes } from './routes/userRoutes'
import { adminRoutes } from './routes/adminRoutes'
import { serviceRoutes } from './routes/serviceRoutes'
import './styles/global.css'

const routes = [
  ...authRoutes,
  ...userRoutes,
  ...adminRoutes,
  ...serviceRoutes,
]

export default function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <Navbar />

      <main id="main-content" className="page-container" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />

          {routes.map(({ path, element }) => (
            <Route key={path} path={path} element={element} />
          ))}

          <Route
            path="*"
            element={
              <section className="card">
                <h1>Page not found</h1>
                <p>The requested page does not exist.</p>
                <Link to="/login" className="button">
                  Go to login
                </Link>
              </section>
            }
          />
        </Routes>
      </main>
    </BrowserRouter>
  )
}