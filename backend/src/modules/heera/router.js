const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { notImplemented } = require('../../shared/errors');
module.exports = function createHeeraRouter({ auth, store, events }) {
  const router = Router();
  router.use('/admin', auth, requireRole('admin'));
  router.get('/admin/dashboard', notImplemented('Admin dashboard'));
  router.get('/admin/services/:serviceId/queue', validate(c.serviceParams, 'params'), notImplemented('Queue listing'));
  router.patch('/admin/services/:serviceId/queue', validate(c.serviceParams, 'params'), validate(c.queueState), notImplemented('Queue open/close'));
  router.post('/admin/services/:serviceId/queue/serve-next', validate(c.serviceParams, 'params'), notImplemented('Serve next'));
  router.patch('/admin/services/:serviceId/queue/:entryId', validate(c.entryParams, 'params'), validate(c.reorder), notImplemented('Queue reorder'));
  router.delete('/admin/services/:serviceId/queue/:entryId', validate(c.entryParams, 'params'), notImplemented('Queue removal'));
  return router;
};
