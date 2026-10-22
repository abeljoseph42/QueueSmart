const { createApp } = require('./app');
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const server = createApp().listen(port, () => console.log(`QueueSmart API listening on port ${port}`));
function shutdown() { server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
