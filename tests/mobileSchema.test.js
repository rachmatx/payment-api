const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db/connection');
const { ensureMobilePaymentSchema } = require('../src/db/mobileSchema');
test('legacy schema gains nullable idempotency keys without losing existing transactions', async () => {
  const db = await openDatabase(':memory:');
  try {
    await db.exec('CREATE TABLE transactions (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL);');
    await db.run("INSERT INTO transactions (id, merchant_id) VALUES ('legacy', 'M1')");
    await ensureMobilePaymentSchema(db);
    await ensureMobilePaymentSchema(db);
    assert.equal((await db.get("SELECT * FROM transactions WHERE id='legacy'")).idempotency_key, null);
    await db.run("INSERT INTO transactions VALUES ('a', 'M1', 'same-key')");
    await assert.rejects(db.run("INSERT INTO transactions VALUES ('b', 'M1', 'same-key')"));
    await db.run("INSERT INTO transactions VALUES ('c', 'M2', 'same-key')");
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM transactions')).n, 3);
  } finally { await db.close(); }
});
