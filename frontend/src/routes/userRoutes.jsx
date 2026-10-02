import PlaceholderPage from '../components/common/PlaceholderPage'
import UserDashboard from '../pages/user/UserDashboard'

import JoinQueue from '../pages/user/JoinQueue'
import QueueStatus from '../pages/user/QueueStatus'

export const userRoutes = [
  {
    path: '/dashboard',
    element: <UserDashboard />,
  },
  {
    path: '/join-queue',
    element: <JoinQueue />,
  },
  {
    path: '/queue-status',
    element: <QueueStatus />,
  },
  {
    path: '/history',
    element: <PlaceholderPage title="History" />,
  },
]