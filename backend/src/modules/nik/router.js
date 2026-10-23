const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { notImplemented } = require('../../shared/errors');
module.exports = function createNikRouter({
  auth,
  store,
  events,
  authService,
}) {
  const router = Router();
    router.post('/auth/register', validate(c.register), async (req, res) => {
    await authService.register(req.validated.body);

    const result = await authService.login(req.validated.body);

    res.status(201).json({ data: result });
  });

  router.post('/auth/login', validate(c.login), async (req, res) => {
    const result = await authService.login(req.validated.body);

    res.json({ data: result });
  });
  router.get('/auth/me', auth, (req, res) => res.json({ data: req.user }));
  router.get('/services', notImplemented('Service listing'));
  router.post('/services', auth, requireRole('admin'), validate(c.createService), notImplemented('Service creation'));
  router.patch('/services/:serviceId', auth, requireRole('admin'), validate(c.serviceParams, 'params'),
    validate(c.updateService), notImplemented('Service editing'));
  return router;
};
