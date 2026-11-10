require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');
function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/transactions', require('./routes/transactions'));
  app.get('/health', (req, res) => res.json({ status: 'OK', mode: 'SIMULATION' }));
  return app;
}
async function startServer() {
  await getDb();
  return createApp().listen(process.env.PORT || 3000, '0.0.0.0');
}
if (require.main === module) startServer().catch(() => { console.error('Payment API startup failed; verify private configuration.'); process.exitCode = 1; });
module.exports = { createApp, startServer };
