import PlaceholderPage from '../components/common/PlaceholderPage'
import UserDashboard from '../pages/user/UserDashboard'

export const userRoutes = [
  {
    path: '/dashboard',
    element: <UserDashboard />,
  },
  {
    path: '/join-queue',
    element: <PlaceholderPage title="Join Queue" />,
  },
  {
    path: '/queue-status',
    element: <PlaceholderPage title="Queue Status" />,
  },
  {
    path: '/history',
    element: <PlaceholderPage title="History" />,
  },
]