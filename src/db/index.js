const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./connection');
const { ensureWebhookSecretColumn } = require('./webhookSchema');
const { ensureMobilePaymentSchema } = require('./mobileSchema');
let dbPromise;
async function initialize() {
  // Preserve the old location unless the operator explicitly configures DB_FILE.
  const filename = process.env.DB_FILE ? (process.env.DB_FILE === ':memory:' ? ':memory:' : path.resolve(process.env.DB_FILE)) : path.join(__dirname, 'database.sqlite');
  const db = await openDatabase(filename);
  await db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await ensureWebhookSecretColumn(db);
  await ensureMobilePaymentSchema(db);
  const row = await db.get('SELECT * FROM merchants WHERE id = ?', ['M1']);
  const key = process.env.API_KEY || row?.api_key;
  const secret = process.env.PAYMENT_WEBHOOK_SECRET || row?.webhook_secret;
  if (!key) throw new Error('API_KEY is required to provision a new merchant');
  if (secret && secret === key) throw new Error('Webhook secret must differ from merchant API key');
  if (!row) {
    await db.run('INSERT INTO merchants (id, name, api_key, webhook_secret, callback_url) VALUES (?, ?, ?, ?, ?)',
      ['M1', 'Sparkleen Laundry', key, secret || null, process.env.CALLBACK_URL || null]);
  } else {
    if (process.env.API_KEY) await db.run('UPDATE merchants SET api_key = ? WHERE id = ?', [key, 'M1']);
    if (process.env.PAYMENT_WEBHOOK_SECRET) await db.run('UPDATE merchants SET webhook_secret = ? WHERE id = ?', [secret, 'M1']);
    if (process.env.CALLBACK_URL !== undefined) await db.run('UPDATE merchants SET callback_url = ? WHERE id = ?', [process.env.CALLBACK_URL || null, 'M1']);
  }
  return db;
}
function getDb() {
  if (!dbPromise) dbPromise = initialize().catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}
module.exports = { getDb };
