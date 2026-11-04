const { createApp } = require('./app');
const { createStore } = require('./shared/store');
const { createDemoAdmin } = require('./modules/nik/bootstrap');
const { openDatabase } = require('./database/connection');
const { runMigrations } = require('./database/migrate');

async function start() {
  const port = Number(process.env.PORT || 3001);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }

  const db = openDatabase();

  try {
    runMigrations(db);

    const store = createStore();

    const admin = await createDemoAdmin({
      store,
      db,
      email: process.env.DEMO_ADMIN_EMAIL,
      password: process.env.DEMO_ADMIN_PASSWORD,
    });

    const app = createApp({ store, db });

    const server = app.listen(port, () => {
      console.log(`QueueSmart API listening on port ${port}`);

      if (admin) {
        console.log('Configured demo administrator is ready.');
      }
    });

    let closing = false;

    function closeDatabase() {
      app.locals.stopSubscribers();
      db.close();
    }

    server.once('error', error => {
      console.error(`Server failed to start: ${error.message}`);
      closeDatabase();
      process.exitCode = 1;
    });

    function shutdown() {
      if (closing) return;
      closing = true;

      server.close(() => {
        closeDatabase();
        process.exit(0);
      });
    }

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    db.close();
    throw error;
  }
}

start().catch(error => {
  console.error(`Startup failed: ${error.message}`);
  process.exitCode = 1;
});