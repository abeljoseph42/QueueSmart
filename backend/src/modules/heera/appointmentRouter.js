const { Router } = require('express');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { createServiceRepository } = require('../abel/serviceRepository');
const { APPOINTMENT_STATUSES, createAppointmentRepository } = require('./appointmentRepository');

// The user comes from the session; a body can only pick the service and start time.
const bookBody = z.object({
  serviceId: z.string().trim().min(1).max(100),
  startsAt: z.string().min(1).max(40),
}).strict();
const listQuery = z.object({ status: z.enum(APPOINTMENT_STATUSES).optional() }).strict();
const appointmentParams = z.object({ appointmentId: z.string().trim().min(1).max(100) });
const serviceParams = z.object({ serviceId: z.string().trim().min(1).max(100) });

function createAppointmentRouter({ db, auth, now }) {
  const router = Router();
  const appointments = createAppointmentRepository(db, now ? { now } : undefined);
  const services = createServiceRepository(db);
  const admin = [auth, requireRole('admin')];

  router.post('/appointments', auth, validate(bookBody), (req, res) => {
    const appointment = appointments.create({ ...req.validated.body, userId: req.user.id });
    res.status(201).json({ data: appointment });
  });

  router.get('/me/appointments', auth, validate(listQuery, 'query'), (req, res) => {
    res.json({ data: appointments.listByUser(req.user.id, req.validated.query) });
  });

  // Another user's appointment answers 404, so its existence is not revealed.
  router.post('/me/appointments/:appointmentId/cancel', auth, validate(appointmentParams, 'params'), (req, res) => {
    res.json({ data: appointments.cancel(req.validated.params.appointmentId, { userId: req.user.id }) });
  });

  router.get('/admin/services/:serviceId/appointments', ...admin, validate(serviceParams, 'params'),
    validate(listQuery, 'query'), (req, res) => {
      const { serviceId } = req.validated.params;
      services.getService(serviceId);
      res.json({ data: appointments.listByService(serviceId, req.validated.query) });
    });

  router.post('/admin/appointments/:appointmentId/cancel', ...admin, validate(appointmentParams, 'params'),
    (req, res) => res.json({ data: appointments.cancel(req.validated.params.appointmentId) }));

  router.post('/admin/appointments/:appointmentId/complete', ...admin, validate(appointmentParams, 'params'),
    (req, res) => res.json({ data: appointments.complete(req.validated.params.appointmentId) }));

  return router;
}

module.exports = { createAppointmentRouter };
