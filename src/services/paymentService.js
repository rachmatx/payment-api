const axios = require('axios');
const { getDb } = require('../db');
const crypto = require('crypto');

async function verifyPayment(transactionId) {
  const db = await getDb();
  const transaction = await db.get(
    'SELECT * FROM transactions WHERE id = ?', 
    [transactionId]
  );

  if (!transaction) throw new Error('Transaksi tidak ditemukan');
  if (transaction.status !== 'PENDING') {
    return { alreadyProcessed: true, status: transaction.status };
  }

  // --- PROTOTYPE: Simulasi selalu sukses ---
  const isSuccess = true; 
  return { alreadyProcessed: false, isSuccess };
}

function generateSignature(payload, secret) {
  const str = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

async function sendCallback(transaction, merchant) {
  if (!merchant.callback_url) return;

  const payload = {
    event: 'payment.success',
    transaction_id: transaction.id,
    merchant_id: merchant.id,
    amount: transaction.amount,
    method: transaction.method,
    payment_detail: JSON.parse(transaction.payment_detail || '{}'),
    paid_at: transaction.paid_at,
  };

  try {
    const signature = generateSignature(payload, merchant.api_key);
    
    await axios.post(merchant.callback_url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      timeout: 5000,
    });

    console.log(`Callback berhasil dikirim ke ${merchant.callback_url}`);
  } catch (err) {
    console.error(`Callback gagal: ${err.message}`);
  }
}

module.exports = { verifyPayment, sendCallback, generateSignature };
