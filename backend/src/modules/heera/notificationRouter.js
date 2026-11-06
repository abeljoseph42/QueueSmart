const { Router } = require('express');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { NOTIFICATION_STATUSES } = require('./notificationService');

const utc = z.iso.datetime();
const status = z.enum(NOTIFICATION_STATUSES);

// Heera's own response schemas. The user view leaves out delivery internals
// (eventKey, attempts, lastError); zod drops any field not listed here.
const userNotification = z.object({
  id: z.string(),
  type: z.string(),
  subject: z.string(),
  message: z.string(),
  status,
  createdAt: utc,
  sentAt: utc.nullable(),
  viewedAt: utc.nullable(),
});
const adminNotification = userNotification.extend({
  userId: z.string(),
  eventKey: z.string(),
  attempts: z.number().int().min(0).max(3),
  lastError: z.string().nullable(),
  updatedAt: utc,
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  status: status.optional(),
}).strict();
const notificationParams = z.object({ notificationId: z.string().trim().min(1).max(100) });

const toPage = (result, schema) => ({ ...result, items: result.items.map(item => schema.parse(item)) });

function createNotificationRouter({ auth, notifications }) {
  const router = Router();
  const admin = [auth, requireRole('admin')];

  // The signed-in user's notification history, newest first, 20 per page.
  router.get('/me/notifications', auth, validate(pageQuery, 'query'), (req, res) => {
    res.json({ data: toPage(notifications.listForUser(req.user.id, req.validated.query), userNotification) });
  });

  // Another user's notification answers 404.
  router.post('/me/notifications/:notificationId/view', auth, validate(notificationParams, 'params'), (req, res) => {
    const viewed = notifications.markViewed(req.validated.params.notificationId, req.user.id);
    res.json({ data: userNotification.parse(viewed) });
  });

  router.get('/admin/notifications', ...admin, validate(pageQuery, 'query'), (req, res) => {
    res.json({ data: toPage(notifications.listAll(req.validated.query), adminNotification) });
  });

  // Waits for the retried email so the response shows whether it was sent or failed again.
  router.post('/admin/notifications/:notificationId/retry', ...admin, validate(notificationParams, 'params'),
    async (req, res) => {
      const retried = await notifications.retryNotification(req.validated.params.notificationId);
      res.json({ data: adminNotification.parse(retried) });
    });

  return router;
}

module.exports = { createNotificationRouter, userNotification, adminNotification };
