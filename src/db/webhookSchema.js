// Nullable migration: existing merchants keep their identity/API key; no signing
// secret is guessed from a client-facing API key or generated into tracked files.
async function ensureWebhookSecretColumn(db) {
  const columns = await db.all('PRAGMA table_info(merchants)');
  if (!columns.some(column => column.name === 'webhook_secret')) {
    await db.exec('ALTER TABLE merchants ADD COLUMN webhook_secret TEXT');
  }
}
module.exports = { ensureWebhookSecretColumn };
