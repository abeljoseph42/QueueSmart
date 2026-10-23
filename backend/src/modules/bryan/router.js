const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const queue = require('./queueService');
module.exports = function createBryanRouter({ auth, store, events }) {
  const router = Router();
  const target = req => ({ serviceId: req.validated.params.serviceId, userId: req.user.id });
  router.post('/services/:serviceId/queue/join', auth, validate(c.serviceParams, 'params'),
    validate(c.joinQueue), (req, res) => {
      res.status(201).json({ data: queue.joinQueue({ store, events }, target(req)) });
    });
  router.delete('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), (req, res) => {
    res.json({ data: queue.leaveQueue({ store, events }, target(req)) });
  });
  router.get('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), (req, res) => {
    res.json({ data: queue.getMyStatus({ store }, target(req)) });
  });
  return router;
};