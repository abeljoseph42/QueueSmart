const { Router } = require('express');
const { notImplemented } = require('../../shared/errors');
module.exports = function createAbelRouter({ auth, store, events }) {
  const router = Router();
  // Abel: subscribe to queue events for notifications/history in a separate module.
  router.get('/me/dashboard', auth, notImplemented('User dashboard'));
  router.get('/me/history', auth, notImplemented('User history'));
  router.get('/me/notifications', auth, notImplemented('User notifications'));
  return router;
};
