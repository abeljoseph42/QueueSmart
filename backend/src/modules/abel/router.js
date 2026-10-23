const { Router } = require('express');
const { listNotifications } = require('./notifications');
const { listHistory } = require('./history');
const { getDashboard } = require('./dashboard');
module.exports = function createAbelRouter({ auth, store, events }) {
  const router = Router();
  router.get('/me/dashboard', auth, (req, res) => {
    res.json({ data: getDashboard(store, req.user.id) });
  });
  router.get('/me/history', auth, (req, res) => {
    res.json({ data: listHistory(store, req.user.id) });
  });
  router.get('/me/notifications', auth, (req, res) => {
    res.json({ data: listNotifications(store, req.user.id) });
  });
  return router;
};
