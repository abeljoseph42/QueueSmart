const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const queue = require('./queueService');
const { createQueueEntryService } = require('./queueEntryService');
module.exports = function createBryanRouter({ auth, store, events, db }) {
  const router = Router();
  const entries = db ? createQueueEntryService({ db, store, events }) : null;
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
  return router;
};