import AdminDashboard from '../pages/admin/AdminDashboard'
import QueueManagement from '../pages/admin/QueueManagement'

export const adminRoutes = [
  {
    path: '/admin',
    element: <AdminDashboard />,
  },
  {
    path: '/admin/queues',
    element: <QueueManagement />,
  },
]