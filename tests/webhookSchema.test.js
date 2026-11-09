const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureWebhookSecretColumn } = require('../src/db/webhookSchema');

test('existing merchant schema gains a nullable server key without changing merchant credentials', async () => {
  const native = new DatabaseSync(':memory:');
  try {
    native.exec("CREATE TABLE merchants (id TEXT PRIMARY KEY, api_key TEXT UNIQUE); INSERT INTO merchants VALUES ('M1', 'local-merchant-api-key');");
    const db = { all: async sql => native.prepare(sql).all(), exec: async sql => native.exec(sql) };
    await ensureWebhookSecretColumn(db);
    await ensureWebhookSecretColumn(db);
    const row = native.prepare('SELECT * FROM merchants').get();
    assert.equal(row.id, 'M1');
    assert.equal(row.api_key, 'local-merchant-api-key');
    assert.equal(row.webhook_secret, null);
    assert.equal(native.prepare('PRAGMA table_info(merchants)').all().filter(column => column.name === 'webhook_secret').length, 1);
  } finally { native.close(); }
});
