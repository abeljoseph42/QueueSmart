const express = require('express');
const cors = require('cors');
const { createStore } = require('./shared/store');
const { createEventBus } = require('./shared/events');
const { requireAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./shared/errors');
const routers = ['nik', 'abel', 'bryan', 'heera'].map(owner => require(`./modules/${owner}/router`));
const {
  createAuthService,
} = require('./modules/nik/auth.service');
function createApp({ store = createStore(), events = createEventBus(), resolveUser,
  frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  const authService = createAuthService({ store });

  const context = {
    store,
    events,
    authService,
auth: requireAuth(resolveUser ?? authService.resolveUser),
  };
  app.locals.store = store;
  app.locals.events = events;
  routers.forEach(createRouter => app.use('/api', createRouter(context)));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
