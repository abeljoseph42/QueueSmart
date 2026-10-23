const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { ApiError, notImplemented } = require('../../shared/errors');
const { getOrderedWaiting } = require('./queueView');
module.exports = function createHeeraRouter({ auth, store, events }) {
  const router = Router();
  router.use('/admin', auth, requireRole('admin'));
  router.get('/admin/dashboard', (_req, res) => {
    const services = [...store.services.values()];
    const entries = [...store.queueEntries.values()];
    res.json({ data: c.adminDashboard.parse({
      serviceCount: store.services.size,
      waitingCount: entries.filter(entry => entry.status === 'waiting').length,
      openServiceCount: services.filter(service => service.isOpen === true).length,
    }) });
  });
  router.get('/admin/services/:serviceId/queue', validate(c.serviceParams, 'params'), (req, res, next) => {
    const { serviceId } = req.validated.params;
    if (!store.services.has(serviceId)) return next(new ApiError(404, 'NOT_FOUND', 'Service not found.'));
    res.json({ data: getOrderedWaiting(store, serviceId) });
  });
  router.patch('/admin/services/:serviceId/queue', validate(c.serviceParams, 'params'), validate(c.queueState), notImplemented('Queue open/close'));
  router.post('/admin/services/:serviceId/queue/serve-next', validate(c.serviceParams, 'params'), notImplemented('Serve next'));
  router.patch('/admin/services/:serviceId/queue/:entryId', validate(c.entryParams, 'params'), validate(c.reorder), notImplemented('Queue reorder'));
  router.delete('/admin/services/:serviceId/queue/:entryId', validate(c.entryParams, 'params'), notImplemented('Queue removal'));
  return router;
};
