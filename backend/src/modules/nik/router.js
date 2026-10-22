const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { notImplemented } = require('../../shared/errors');
module.exports = function createNikRouter({ auth, store, events }) {
  const router = Router();
  // Nik: replace handlers with auth/service controllers using injected store/events.
  router.post('/auth/register', validate(c.register), notImplemented('Registration'));
  router.post('/auth/login', validate(c.login), notImplemented('Login'));
  router.get('/auth/me', auth, (req, res) => res.json({ data: req.user }));
  router.get('/services', notImplemented('Service listing'));
  router.post('/services', auth, requireRole('admin'), validate(c.createService), notImplemented('Service creation'));
  router.patch('/services/:serviceId', auth, requireRole('admin'), validate(c.serviceParams, 'params'),
    validate(c.updateService), notImplemented('Service editing'));
  return router;
};
