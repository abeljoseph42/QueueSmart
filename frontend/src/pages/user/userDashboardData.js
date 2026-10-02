// Mock data for the User Dashboard.

export const currentQueue = {
  serviceId: 1,
  serviceName: 'DMV Services',
  status: 'Waiting',
  position: 4,
  estimatedWaitMinutes: 12,
}

export const recentNotifications = [
  { id: 1, message: "You're now #4 in line." },
  { id: 2, message: 'Estimated wait time decreased to 12 minutes.' },
]

export const availableServices = [
  {
    id: 1,
    name: 'DMV Services',
    description: 'License renewals, vehicle registration, and ID cards.',
    peopleWaiting: 8,
    estimatedWaitMinutes: 12,
    isOpen: true,
  },
  {
    id: 2,
    name: 'Student Advising',
    description: 'Course planning and degree audit help.',
    peopleWaiting: 3,
    estimatedWaitMinutes: 10,
    isOpen: true,
  },
  {
    id: 3,
    name: 'IT Help Desk',
    description: 'Account access, Wi-Fi, and device troubleshooting.',
    peopleWaiting: 6,
    estimatedWaitMinutes: 20,
    isOpen: true,
  },
  {
    id: 4,
    name: 'Financial Services',
    description: 'Questions about billing, payments, and refunds.',
    peopleWaiting: 0,
    estimatedWaitMinutes: 0,
    isOpen: false,
  },
]
