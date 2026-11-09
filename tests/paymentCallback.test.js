const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildSignedCallback, deliverCallback, isValidAmount, callbackConfigured } = require('../src/services/paymentCallback');

const merchant = { id: 'M-test', api_key: 'local-merchant-key', webhook_secret: 'local-test-key-not-a-secret', callback_url: 'http://127.0.0.1/webhook/payment' };
const transaction = {
  id: 'test-gateway-1', merchant_id: merchant.id, customer_ref: 'LAU/20261110/0001',
  status: 'SUCCESS', amount: 35000, method: 'QRIS', paid_at: '2026-11-10T00:00:00.000Z',
  payment_detail: JSON.stringify({ merchant_name: 'Laundry "Bersih" 🌿' }),
};

test('callback binds gateway id, merchant, nota, amount, method and success status to exact signed bytes', () => {
  const result = buildSignedCallback(transaction, merchant);
  assert.deepEqual(JSON.parse(result.rawBody), result.payload);
  for (const field of ['merchant_id', 'customer_ref', 'amount', 'method', 'status']) {
    assert.equal(result.payload[field], transaction[field]);
  }
  assert.equal(result.signature, crypto.createHmac('sha256', merchant.webhook_secret).update(result.rawBody).digest('hex'));
  assert.notEqual(result.signature, crypto.createHmac('sha256', merchant.webhook_secret).update(`${result.rawBody} `).digest('hex'));
});

test('sender passes the same signed string to its HTTP transport', async () => {
  let calls = 0;
  const result = await deliverCallback(transaction, merchant, async (url, body, options) => {
    calls++;
    assert.equal(url, merchant.callback_url);
    assert.equal(typeof body, 'string');
    assert.equal(options.headers['X-Signature'], crypto.createHmac('sha256', merchant.webhook_secret).update(body).digest('hex'));
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.timeout, 5000);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { delivered: true });
});

test('malformed or non-successful transactions cannot produce a success callback', () => {
  for (const patch of [
    { status: 'PENDING' }, { status: 'FAILED' }, { merchant_id: 'other' }, { customer_ref: null },
    { amount: '35000' }, { amount: 35000.5 }, { amount: -1 }, { amount: 0 },
    { method: 'CASH' }, { paid_at: 'not-a-date' }, { id: '' },
  ]) assert.throws(() => buildSignedCallback({ ...transaction, ...patch }, merchant));
  assert.throws(() => buildSignedCallback(transaction, { ...merchant, webhook_secret: '' }));
});

test('amount validation rejects coerced, fractional and unsafe values', () => {
  for (const amount of ['35000', null, true, {}, -1, 0, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isValidAmount(amount), false);
  }
  assert.equal(isValidAmount(35000), true);
});

test('missing callback URL does not issue a request', async () => {
  await deliverCallback(transaction, { ...merchant, callback_url: '' }, () => assert.fail('unexpected request'));
});

test('transport failure is reported without leaking body or signing material to logs', async (t) => {
  const output = [];
  t.mock.method(console, 'error', (...args) => output.push(JSON.stringify(args)));
  const result = await deliverCallback(transaction, merchant, async () => {
    const error = new Error(`private body ${merchant.api_key}`);
    error.response = { status: 409, data: transaction };
    throw error;
  });
  assert.deepEqual(result, { delivered: false });
  assert.equal(output.length, 1);
  assert.ok(!output[0].includes(merchant.api_key));
  assert.ok(!output[0].includes(merchant.webhook_secret));
  assert.ok(!output[0].includes(transaction.customer_ref));
});

test('merchant API keys cannot substitute for a server webhook key', () => {
  assert.equal(callbackConfigured({ ...merchant, webhook_secret: null }), false);
  assert.equal(callbackConfigured({ ...merchant, webhook_secret: merchant.api_key }), false);
  assert.throws(() => buildSignedCallback(transaction, { ...merchant, webhook_secret: undefined }));
  const signed = buildSignedCallback(transaction, merchant);
  assert.notEqual(signed.signature, crypto.createHmac('sha256', merchant.api_key).update(signed.rawBody).digest('hex'));
});
