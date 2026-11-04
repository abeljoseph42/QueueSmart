import History from '../pages/user/History'
import UserDashboard from '../pages/user/UserDashboard'
import Profile from '../pages/user/Profile'

import JoinQueue from '../pages/user/JoinQueue'
import QueueStatus from '../pages/user/QueueStatus'
import Appointments from '../pages/user/Appointments'
import NotificationHistory from '../pages/user/NotificationHistory'

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
    element: <History />,
  },
  {
    path: '/profile',
    element: <Profile />,
  },
  {
    path: '/appointments',
    element: <Appointments />,
  },
  {
    path: '/notifications',
    element: <NotificationHistory />,
  },
]