async function ensureMobilePaymentSchema(db) {
  const columns = await db.all('PRAGMA table_info(transactions)');
  if (!columns.some(column => column.name === 'idempotency_key')) {
    await db.exec('ALTER TABLE transactions ADD COLUMN idempotency_key TEXT');
  }
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS transaction_request_key ON transactions(merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL');
}
module.exports = { ensureMobilePaymentSchema };
