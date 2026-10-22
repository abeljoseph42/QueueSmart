const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { notImplemented } = require('../../shared/errors');
module.exports = function createBryanRouter({ auth, store, events }) {
  const router = Router();
  // Bryan: user queue operations and wait-time calculation; reuse shared entries.
  router.post('/services/:serviceId/queue/join', auth, validate(c.serviceParams, 'params'),
    validate(c.joinQueue), notImplemented('Join queue'));
  router.delete('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), notImplemented('Leave queue'));
  router.get('/services/:serviceId/queue/me', auth, validate(c.serviceParams, 'params'), notImplemented('Queue status'));
  return router;
};
