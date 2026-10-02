import AdminDashboard from '../pages/admin/AdminDashboard'
import PlaceholderPage from '../components/common/PlaceholderPage'

export const adminRoutes = [
  {
    path: '/admin',
    element: <AdminDashboard />,
  },
  {
    path: '/admin/queues',
    element: <PlaceholderPage title="Queue Management" />,
  },
]