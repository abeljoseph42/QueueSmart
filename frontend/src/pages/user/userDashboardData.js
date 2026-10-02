// Mock data for the User Dashboard.

export const currentQueue = {
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
    name: 'Passport Office',
    description: 'New passport applications and renewals.',
    peopleWaiting: 15,
    estimatedWaitMinutes: 35,
    isOpen: true,
  },
  {
    id: 3,
    name: 'Student Advising',
    description: 'Course planning and degree audit help.',
    peopleWaiting: 3,
    estimatedWaitMinutes: 10,
    isOpen: true,
  },
  {
    id: 4,
    name: 'Financial Aid',
    description: 'Questions about scholarships, loans, and payment plans.',
    peopleWaiting: 0,
    estimatedWaitMinutes: 0,
    isOpen: false,
  },
]
