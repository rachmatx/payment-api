const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sparkleen-node-payments-'));
const key = 'local-api-test-key';
const secret = 'local-separate-webhook-test-key';
process.env.DB_FILE = path.join(directory, 'test.sqlite');
process.env.API_KEY = key;
process.env.PAYMENT_WEBHOOK_SECRET = secret;
process.env.CALLBACK_URL = '';
const { getDb } = require('../src/db');
const { createApp } = require('../src/app');
let server, base, db;
before(async () => {
  db = await getDb();
  await db.run("UPDATE merchants SET qris_data = 'real-qr-do-not-expose', account_number = 'real-account-do-not-expose' WHERE id = 'M1'");
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/transactions`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
async function request(url = '', body, extra = {}) {
  const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text();
  return { status: response.status, raw, signature: response.headers.get('X-Webhook-Signature'), body: JSON.parse(raw) };
}
async function create(method = 'QRIS', requestKey = crypto.randomBytes(16).toString('hex')) {
  return request('', { amount: 35000, method, customer_ref: `TEST-${requestKey}` }, { 'Idempotency-Key': requestKey });
}
test('creation and status are signed with the server key and expose demo instruments only', async () => {
  const result = await create();
  assert.equal(result.status, 201);
  assert.equal(result.signature, crypto.createHmac('sha256', secret).update(result.raw).digest('hex'));
  assert.equal(result.body.data.mode, 'SIMULATION');
  assert.equal(result.body.data.payment_detail.qris_data, result.body.data.transaction_id);
  assert.ok(!result.raw.includes('real-qr-do-not-expose'));
  assert.ok(!result.raw.includes(key)); assert.ok(!result.raw.includes(secret));
  const status = await request(`/${result.body.data.transaction_id}/status`);
  assert.equal(status.signature, crypto.createHmac('sha256', secret).update(status.raw).digest('hex'));
});
test('same request key resumes one intent and mismatched reuse is rejected', async () => {
  const requestKey = crypto.randomBytes(16).toString('hex');
  const first = await create('QRIS', requestKey);
  const again = await create('QRIS', requestKey);
  assert.equal(again.status, 200);
  assert.equal(first.body.data.transaction_id, again.body.data.transaction_id);
  const wrong = await request('', { amount: 1, method: 'QRIS', customer_ref: `TEST-${requestKey}` }, { 'Idempotency-Key': requestKey });
  assert.equal(wrong.status, 409);
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM transactions WHERE idempotency_key = ?', [requestKey])).total, 1);
});
test('bank details are explicitly fake and cannot expose configured bank instruments', async () => {
  const result = await create('BANK_TRANSFER');
  assert.equal(result.body.data.payment_detail.bank_name, 'BANK SIMULASI');
  assert.equal(result.body.data.payment_detail.account_number, 'DEMO-NOT-A-BANK-ACCOUNT');
});
test('cancellation is idempotent and cancelled intent cannot be paid', async () => {
  const id = (await create()).body.data.transaction_id;
  assert.equal((await request(`/${id}/cancel`, {})).body.data.status, 'CANCELLED');
  assert.equal((await request(`/${id}/cancel`, {})).body.data.status, 'CANCELLED');
  assert.equal((await request(`/${id}/pay`, {})).status, 409);
});
test('paid intent cannot be disguised as cancelled', async () => {
  const id = (await create()).body.data.transaction_id;
  assert.equal((await request(`/${id}/pay`, {})).body.data.status, 'SUCCESS');
  assert.equal((await request(`/${id}/cancel`, {})).body.data.status, 'SUCCESS');
});
test('pay and cancel racing cannot both change pending state', async () => {
  const id = (await create()).body.data.transaction_id;
  const [pay, cancel] = await Promise.all([request(`/${id}/pay`, {}), request(`/${id}/cancel`, {})]);
  const row = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
  assert.ok(['SUCCESS', 'CANCELLED'].includes(row.status));
  if (row.status === 'SUCCESS') { assert.equal(pay.status, 200); assert.equal(cancel.body.data.status, 'SUCCESS'); }
  else assert.equal(pay.status, 409);
});
test('expired intent cannot be confirmed manually or paid', async () => {
  const id = (await create()).body.data.transaction_id;
  await db.run('UPDATE transactions SET expired_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', id]);
  assert.equal((await request(`/${id}/status`)).body.data.status, 'EXPIRED');
  assert.equal((await request(`/${id}/confirm`, {})).status, 410);
  assert.equal((await request(`/${id}/pay`, {})).status, 410);
});
test('status is scoped to merchant and unauthenticated requests are refused', async () => {
  const id = (await create()).body.data.transaction_id;
  await db.run('INSERT INTO merchants (id, name, api_key, webhook_secret) VALUES (?, ?, ?, ?)', ['M2', 'Other', 'other-local-key', 'other-server-secret']);
  assert.equal((await request(`/${id}/status`, undefined, { 'X-Api-Key': 'other-local-key' })).status, 404);
  assert.equal((await fetch(base)).status, 401);
});
