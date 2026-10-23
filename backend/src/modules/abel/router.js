const { Router } = require('express');
const { notImplemented } = require('../../shared/errors');
const { listNotifications } = require('./notifications');
const { listHistory } = require('./history');
module.exports = function createAbelRouter({ auth, store, events }) {
  const router = Router();
  // Abel: subscribe to queue events for notifications/history in a separate module.
  router.get('/me/dashboard', auth, notImplemented('User dashboard'));
  router.get('/me/history', auth, (req, res) => {
    res.json({ data: listHistory(store, req.user.id) });
  });
  router.get('/me/notifications', auth, (req, res) => {
    res.json({ data: listNotifications(store, req.user.id) });
  });
  return router;
};
