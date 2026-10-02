import PlaceholderPage from '../components/common/PlaceholderPage'

export const adminRoutes = [
  {
    path: '/admin',
    element: <PlaceholderPage title="Admin Dashboard" />,
  },
  {
    path: '/admin/queues',
    element: <PlaceholderPage title="Queue Management" />,
  },
]