const { createApp } = require('./app');
const { createStore } = require('./shared/store');
const {
  createDemoAdmin,
} = require('./modules/nik/bootstrap');

async function start() {
  const port = Number(process.env.PORT || 3001);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }

  const store = createStore();

  const admin = await createDemoAdmin({
    store,
    email: process.env.DEMO_ADMIN_EMAIL,
    password: process.env.DEMO_ADMIN_PASSWORD,
  });

  const app = createApp({ store });

  const server = app.listen(port, () => {
    console.log(`QueueSmart API listening on port ${port}`);

    if (admin) {
      console.log('Configured demo administrator is ready.');
    }
  });

  server.on('error', error => {
    console.error(`Server failed to start: ${error.message}`);
    process.exitCode = 1;
  });

  function shutdown() {
    server.close(() => process.exit(0));
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch(error => {
  console.error(`Startup failed: ${error.message}`);
  process.exitCode = 1;
});