const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { notImplemented } = require('../../shared/errors');
const queue = require('./queueService');
module.exports = function createBryanRouter({ auth, store, events }) {
  const router = Router();
  router.post('/services/:serviceId/queue/join', auth, validate(c.serviceParams, 'params'),
    validate(c.joinQueue), (req, res) => {
      const status = queue.joinQueue({ store, events },
        { serviceId: req.validated.params.serviceId, userId: req.user.id });
      res.status(201).json({ data: status });
    });
  router.delete('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), notImplemented('Leave queue'));
  router.get('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), notImplemented('Queue status'));
  return router;
};