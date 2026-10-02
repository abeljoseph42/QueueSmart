// Mock notifications for the logged-in user, newest first.

export const notifications = [
  {
    id: 1,
    type: 'queue-update',
    message: "You're now #4 in line.",
    time: '2 min ago',
    isRead: false,
  },
  {
    id: 2,
    type: 'queue-update',
    message: 'Estimated wait time decreased to 12 minutes.',
    time: '5 min ago',
    isRead: false,
  },
  {
    id: 3,
    type: 'status-change',
    message: 'Your status for DMV Services changed to Waiting.',
    time: '18 min ago',
    isRead: true,
  },
  {
    id: 4,
    type: 'status-change',
    message: 'You joined the DMV Services queue.',
    time: '20 min ago',
    isRead: true,
  },
]
