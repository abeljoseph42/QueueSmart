const { Router } = require('express');
const { z } = require('zod');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { ApiError } = require('../../shared/errors');
const queue = require('./queueService');
const { createQueueEntryService } = require('./queueEntryService');
const { createNotificationService } = require('../heera/notificationService');

const entryUpdate = z.union([c.reorder, z.object({ priority: c.priority }).strict()]);

module.exports = function createBryanRouter({ auth, store, events, db, notificationService }) {
  const router = Router();
  const notifications = db ? notificationService ?? createNotificationService(db) : undefined;
  const entries = db ? createQueueEntryService({ db, store, events, notifications }) : null;
  if (entries) entries.hydrate();
  const target = req => ({ serviceId: req.validated.params.serviceId, userId: req.user.id });
  router.post('/services/:serviceId/queue/join', auth, validate(c.serviceParams, 'params'),
    validate(c.joinQueue), (req, res) => {
      const data = entries
        ? entries.joinByService(req.user, req.validated.params.serviceId)
        : queue.joinQueue({ store, events }, target(req));
      res.status(201).json({ data });
    });
  router.delete('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), (req, res) => {
    const data = entries
      ? entries.leaveByService(req.user, req.validated.params.serviceId)
      : queue.leaveQueue({ store, events }, target(req));
    res.json({ data });
  });
  router.get('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), (req, res) => {
    const data = entries
      ? entries.statusByService(req.user, req.validated.params.serviceId)
      : queue.getMyStatus({ store }, target(req));
    res.json({ data });
  });

  if (entries) {
    const admin = [auth, requireRole('admin')];
    const params = validate(c.serviceParams, 'params');
    const entryParams = validate(c.entryParams, 'params');
    router.get('/admin/services/:serviceId/queue', ...admin, params, (req, res) => {
      res.json({ data: entries.adminQueueByService(req.validated.params.serviceId) });
    });
    router.post('/admin/services/:serviceId/queue/serve-next', ...admin, params, (req, res) => {
      res.json({ data: entries.serveNextByService(req.user, req.validated.params.serviceId) });
    });
    router.patch('/admin/services/:serviceId/queue/:entryId', ...admin, entryParams, validate(entryUpdate),
      (req, res) => {
        const { serviceId, entryId } = req.validated.params;
        if (!('priority' in req.validated.body)) {
          throw new ApiError(409, 'MANUAL_REORDER_DISABLED',
            'Queue order follows priority and join time. Change the entry priority instead.');
        }
        res.json({ data: entries.setPriorityByService(req.user, serviceId, entryId, req.validated.body.priority) });
      });
    router.delete('/admin/services/:serviceId/queue/:entryId', ...admin, entryParams, (req, res) => {
      const { serviceId, entryId } = req.validated.params;
      res.json({ data: entries.removeByService(req.user, serviceId, entryId) });
    });
  }
  return router;
};