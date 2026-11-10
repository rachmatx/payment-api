const crypto = require('node:crypto');

function isValidAmount(amount) {
  return Number.isSafeInteger(amount) && amount > 0;
}

function generateSignature(rawBody, secret) {
  if (typeof secret !== 'string' || !secret.trim()) {
    throw new Error('Callback signing key is required');
  }
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function callbackConfigured(merchant) {
  return (typeof merchant.webhook_secret === 'string'
    && !!merchant.webhook_secret.trim() && merchant.webhook_secret !== merchant.api_key);
}

function buildSignedCallback(transaction, merchant) {
  if (!callbackConfigured(merchant) || typeof merchant.webhook_secret !== 'string' || !merchant.webhook_secret.trim()) {
    throw new Error('A separate server-only webhook signing key is required');
  }
  const text = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 100;
  if (!text(transaction.id) || !text(merchant.id) || transaction.merchant_id !== merchant.id
      || !text(transaction.customer_ref) || !isValidAmount(transaction.amount)
      || !['QRIS', 'BANK_TRANSFER'].includes(transaction.method) || transaction.status !== 'SUCCESS'
      || typeof transaction.paid_at !== 'string' || !Number.isFinite(Date.parse(transaction.paid_at))) {
    throw new Error('Invalid successful payment callback');
  }
  const payload = {
    event: 'payment.success',
    mode: 'SIMULATION',
    transaction_id: transaction.id,
    merchant_id: merchant.id,
    customer_ref: transaction.customer_ref,
    status: 'SUCCESS',
    amount: transaction.amount,
    method: transaction.method,
    payment_detail: transaction.payment_detail ? JSON.parse(transaction.payment_detail) : {},
    paid_at: new Date(transaction.paid_at).toISOString(),
  };
  // Sign and send these exact bytes. Never re-encode the payload after signing.
  const rawBody = JSON.stringify(payload);
  return { payload, rawBody, signature: generateSignature(rawBody, merchant.webhook_secret) };
}

async function deliverCallback(transaction, merchant, post) {
  if (!merchant.callback_url) return;
  try {
    const { rawBody, signature } = buildSignedCallback(transaction, merchant);
    await post(merchant.callback_url, rawBody, {
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
      timeout: 5000,
    });
    return { delivered: true };
  } catch (error) {
    // Do not log signed bodies, callback responses, URLs with credentials or keys.
    console.error('Payment callback failed', { status: error.response?.status || null });
    return { delivered: false };
  }
}

module.exports = { callbackConfigured, isValidAmount, generateSignature, buildSignedCallback, deliverCallback };
