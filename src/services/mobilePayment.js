const { generateSignature } = require('./paymentCallback');
function simulationDetails(transaction, merchant) {
  return transaction.method === 'QRIS'
    ? { qris_data: transaction.id, merchant_name: `${merchant.name} (Simulasi)`, simulation_code: transaction.id }
    : { bank_name: 'BANK SIMULASI', account_number: 'DEMO-NOT-A-BANK-ACCOUNT', account_holder: `${merchant.name} (Simulasi)`, simulation_code: transaction.id };
}
function presentation(transaction, merchant) {
  const status = transaction.status === 'PENDING' && Date.parse(transaction.expired_at) <= Date.now() ? 'EXPIRED' : transaction.status;
  return { id: transaction.id, transaction_id: transaction.id, merchant_id: merchant.id,
    customer_ref: transaction.customer_ref, amount: transaction.amount, method: transaction.method,
    status, mode: 'SIMULATION', expired_at: transaction.expired_at, paid_at: transaction.paid_at || null,
    payment_detail: simulationDetails(transaction, merchant) };
}
function signedResponse(res, code, transaction, merchant) {
  const raw = JSON.stringify({ success: true, data: presentation(transaction, merchant) });
  return res.status(code).set('X-Webhook-Signature', generateSignature(raw, merchant.webhook_secret)).type('application/json').send(raw);
}
module.exports = { simulationDetails, presentation, signedResponse };
