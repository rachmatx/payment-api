// Opt-in integration test. Uses a disposable local Laundry fixture, not Payment API's SQLite DB.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { deliverCallback, buildSignedCallback } = require('../src/services/paymentCallback');

async function main() {
  const base = new URL(process.env.LAUNDRY_TEST_URL || '');
  if (!['localhost', '127.0.0.1'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password) {
    throw new Error('Only an explicit local HTTP test server is allowed');
  }
  const root = process.env.LAUNDRY_TEST_ROOT;
  const php = process.env.TEST_PHP_BIN;
  if (!root || !path.isAbsolute(root) || !php) throw new Error('LAUNDRY_TEST_ROOT and TEST_PHP_BIN are required');
  const fixture = action => {
    const result = spawnSync(php, [path.join(root, 'tools/payment_webhook_demo.php'), action], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Local fixture command failed');
    return action === 'inspect' ? JSON.parse(result.stdout.trim()) : null;
  };
  fixture('reset');
  const snapshot = fixture('inspect');
  const merchant = { id: 'M-http-demo', api_key: 'local-merchant-api-key', webhook_secret: 'webhook-http-test-key', callback_url: new URL('/webhook/payment', base).href };
  const transaction = {
    id: 'webhook-http-demo', merchant_id: merchant.id, customer_ref: snapshot.nota,
    amount: 35000, method: 'QRIS', status: 'SUCCESS', paid_at: '2026-11-10T00:00:00.000Z',
    payment_detail: JSON.stringify({ merchant_name: 'Laundry "Bersih" 🌿' }),
  };
  for (let i = 0; i < 20; i++) {
    try { await fetch(new URL('/login', base), { signal: AbortSignal.timeout(1000) }); break; }
    catch (error) { if (i === 19) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const actualPost = async (url, rawBody, options) => {
    const response = await fetch(url, { method: 'POST', body: rawBody, headers: options.headers, signal: AbortSignal.timeout(options.timeout) });
    if (!response.ok) {
      const error = new Error('HTTP callback rejected');
      error.response = { status: response.status };
      throw error;
    }
    return response.json();
  };
  const signed = buildSignedCallback(transaction, merchant);
  const forged = await fetch(merchant.callback_url, { method: 'POST', body: `${signed.rawBody} `, headers: { 'Content-Type': 'application/json', 'X-Signature': signed.signature } });
  assert.equal(forged.status, 401);
  const wrongAmount = buildSignedCallback({ ...transaction, amount: 10000 }, merchant);
  const wrong = await fetch(merchant.callback_url, { method: 'POST', body: wrongAmount.rawBody, headers: { 'Content-Type': 'application/json', 'X-Signature': wrongAmount.signature } });
  assert.equal(wrong.status, 409);
  assert.deepEqual(fixture('inspect'), snapshot);
  assert.deepEqual(await deliverCallback(transaction, merchant, actualPost), { delivered: true });
  assert.deepEqual(await deliverCallback(transaction, merchant, actualPost), { delivered: true });
  const settled = fixture('inspect');
  assert.equal(settled.count, 1);
  assert.equal(settled.amount, 35000);
  assert.equal(settled.status, 1);
  console.log('PASS: Node signed bytes → PHP HTTP webhook → MariaDB; forged/mismatched rejected, replay records one payment.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
