const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { ApiError } = require('../../shared/errors');
const { EVENTS } = require('../../shared/events');
const { orderedQueue: getOrderedWaiting, checkNearEvents: notifyNear, moveEntry } = require('../bryan/queueService');
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
  router.get('/admin/services/:serviceId/queue', validate(c.serviceParams, 'params'), (req, res) => {
    res.json({ data: getOrderedWaiting(store, req.validated.params.serviceId) });
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
    const queue = moveEntry(store, serviceId, entryId, req.validated.body.position);
    notifyNear(store, events, serviceId);
    res.json({ data: queue });
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
