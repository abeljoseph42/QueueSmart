const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { ApiError } = require('../../shared/errors');
const { EVENTS } = require('../../shared/events');
const { getOrderedWaiting, notifyNear } = require('./queueView');
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
  router.patch('/admin/services/:serviceId/queue', validate(c.serviceParams, 'params'), validate(c.queueState), (req, res, next) => {
    const { serviceId } = req.validated.params;
    const service = store.services.get(serviceId);
    if (!service) return next(new ApiError(404, 'NOT_FOUND', 'Service not found.'));
    const updated = { ...service, isOpen: req.validated.body.isOpen };
    store.services.set(serviceId, updated);
    res.json({ data: c.service.parse(updated) });
  });
  router.post('/admin/services/:serviceId/queue/serve-next', validate(c.serviceParams, 'params'), (req, res, next) => {
    const { serviceId } = req.validated.params;
    if (!store.services.has(serviceId)) return next(new ApiError(404, 'NOT_FOUND', 'Service not found.'));
    const [first] = getOrderedWaiting(store, serviceId);
    if (!first) return next(new ApiError(409, 'CONFLICT', 'Queue is empty.'));
    const updated = { ...store.queueEntries.get(first.entry.id), status: 'served' };
    store.queueEntries.set(updated.id, updated);
    const entry = c.queueEntry.parse(updated);
    events.publish(EVENTS.SERVED, { entry });
    notifyNear(store, events, serviceId);
    res.json({ data: { entry } });
  });
  const findWaiting = ({ serviceId, entryId }) => {
    if (!store.services.has(serviceId)) throw new ApiError(404, 'NOT_FOUND', 'Service not found.');
    const stored = store.queueEntries.get(entryId);
    if (stored?.serviceId !== serviceId || stored.status !== 'waiting')
      throw new ApiError(404, 'NOT_FOUND', 'Queue entry not found.');
    return stored;
  };
  router.patch('/admin/services/:serviceId/queue/:entryId', validate(c.entryParams, 'params'), validate(c.reorder), (req, res) => {
    const { serviceId, entryId } = req.validated.params;
    findWaiting(req.validated.params);
    const ids = getOrderedWaiting(store, serviceId).map(({ entry }) => entry.id).filter(id => id !== entryId);
    const { position } = req.validated.body;
    if (position > ids.length + 1) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
      [{ path: 'position', message: `Position must be between 1 and ${ids.length + 1}.` }]);
    ids.splice(position - 1, 0, entryId);
    ids.forEach((id, i) => store.queueEntries.set(id, { ...store.queueEntries.get(id), manualOrder: i + 1 }));
    notifyNear(store, events, serviceId);
    res.json({ data: getOrderedWaiting(store, serviceId) });
  });
  router.delete('/admin/services/:serviceId/queue/:entryId', validate(c.entryParams, 'params'), (req, res) => {
    const updated = { ...findWaiting(req.validated.params), status: 'removed' };
    store.queueEntries.set(updated.id, updated);
    const entry = c.queueEntry.parse(updated);
    events.publish(EVENTS.REMOVED, { entry });
    notifyNear(store, events, updated.serviceId);
    res.json({ data: { entry } });
  });
  return router;
};
