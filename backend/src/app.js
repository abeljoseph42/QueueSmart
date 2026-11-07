const express = require('express');
const cors = require('cors');
const { createStore } = require('./shared/store');
const { createEventBus } = require('./shared/events');
const { requireAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./shared/errors');
const { initQueueSubscribers } = require('./modules/abel/subscribers');
const {
  createProfileRouter,
} = require('./modules/nik/profile');
const routers = ['nik', 'abel', 'bryan', 'heera'].map(owner => require(`./modules/${owner}/router`));
const {
  createAuthService,
} = require('./modules/nik/auth.service');
const { createServiceManager } = require('./modules/abel/serviceManager');
const { createNotificationService } = require('./modules/heera/notificationService');
function createApp({
  store = createStore(),
  events = createEventBus(),
  resolveUser,
  db,
  frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  const notificationService = db ? createNotificationService(db) : undefined;
  const authService = createAuthService({ store, db, notificationService });

  const context = {
    store,
    events,
    authService,
    notificationService,
    db,
    serviceManager: db ? createServiceManager({ store, db }) : undefined,
auth: requireAuth(resolveUser ?? authService.resolveUser),
  };
  app.locals.store = store;
  app.locals.events = events;
  app.locals.stopSubscribers = initQueueSubscribers({ store, events }, db ? [] : undefined);
  routers.forEach(createRouter => app.use('/api', createRouter(context)));

  if (db) {
    app.use('/api', createProfileRouter({
      db,
      auth: context.auth,
    }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
