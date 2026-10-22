const { z } = require('zod');
// IDs are opaque strings; minutes are integers; dates are UTC ISO 8601 strings.
const id = z.string().trim().min(1).max(100);
const priority = z.enum(['low', 'medium', 'high']);
const role = z.enum(['user', 'admin']);
const serviceFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000),
  expectedDurationMinutes: z.number().int().min(1).max(480),
  priority,
};
const register = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128),
}).strict(); // Public registration cannot choose an administrator role.
const login = register.pick({ email: true, password: true });
const createService = z.object(serviceFields).strict();
const updateService = createService.partial().refine(value => Object.keys(value).length > 0,
  { message: 'At least one service field is required.' });
const serviceParams = z.object({ serviceId: id });
const entryParams = z.object({ serviceId: id, entryId: id });
const joinQueue = z.object({}).strict(); // Identity and priority come from the server.
const queueState = z.object({ isOpen: z.boolean() }).strict();
const reorder = z.object({ position: z.number().int().min(1) }).strict();
const user = z.object({ id, name: serviceFields.name, email: z.email(), role });
const service = createService.extend({ id, isOpen: z.boolean() });
const queueEntry = z.object({ id, serviceId: id, userId: id, priority,
  joinedAt: z.iso.datetime(), status: z.enum(['waiting', 'served', 'left', 'removed']) });
const queueStatus = z.object({ entry: queueEntry, position: z.number().int().min(1),
  estimatedWaitMinutes: z.number().int().min(0) });
const historyRecord = z.object({ id, entryId: id, userId: id, serviceId: id,
  joinedAt: z.iso.datetime(), endedAt: z.iso.datetime(), outcome: z.enum(['served', 'left', 'removed']) });
const notification = z.object({ id, userId: id, entryId: id,
  type: z.enum(['queue.joined', 'queue.near', 'queue.served', 'queue.left', 'queue.removed']),
  message: z.string().min(1), createdAt: z.iso.datetime() });
// Public response contracts; use these when implementing successful handlers.
const authResult = z.object({ user, token: z.string().min(1) });
const userDashboard = z.object({ services: z.array(service), queues: z.array(queueStatus),
  notifications: z.array(notification) });
const adminDashboard = z.object({ serviceCount: z.number().int().min(0),
  waitingCount: z.number().int().min(0), openServiceCount: z.number().int().min(0) });
/** @typedef {import('zod').infer<typeof user>} User */
/** @typedef {import('zod').infer<typeof service>} Service */
/** @typedef {import('zod').infer<typeof queueEntry>} QueueEntry */
/** @typedef {import('zod').infer<typeof queueStatus>} QueueStatus */
/** @typedef {import('zod').infer<typeof historyRecord>} HistoryRecord */
/** @typedef {import('zod').infer<typeof notification>} Notification */
module.exports = { id, priority, role, register, login, createService, updateService,
  serviceParams, entryParams, joinQueue, queueState, reorder, user, service,
  queueEntry, queueStatus, historyRecord, notification, authResult, userDashboard, adminDashboard };
