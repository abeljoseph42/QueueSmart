const { createServiceManager } = require('./service.service');
const { Router } = require('express');
const c = require('../../shared/contracts');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
module.exports = function createNikRouter({
  auth,
  store,
  events,
  authService,
}) {
  const router = Router();
    const serviceManager = createServiceManager({ store });
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
    router.get('/services', (_req, res) => {
    res.json({
      data: serviceManager.listServices(),
    });
  });

  router.post(
    '/services',
    auth,
    requireRole('admin'),
    validate(c.createService),
    (req, res) => {
      const service = serviceManager.createService(
        req.validated.body
      );

      res.status(201).json({ data: service });
    }
  );
    router.patch(
    '/services/:serviceId',
    auth,
    requireRole('admin'),
    validate(c.serviceParams, 'params'),
    validate(c.updateService),
    (req, res) => {
      const service = serviceManager.updateService(
        req.validated.params.serviceId,
        req.validated.body
      );

      res.json({ data: service });
    }
  );
  return router;
};
