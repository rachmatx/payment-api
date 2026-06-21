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

function generateSignature(rawBodyString, secret) {
  return crypto.createHmac('sha256', secret).update(rawBodyString).digest('hex');
}

async function sendCallback(transaction, merchant) {
  if (!merchant.callback_url) return;

  const payload = {
    event: 'payment.success',
    transaction_id: transaction.id,
    merchant_id: merchant.id,
    amount: transaction.amount,
    method: transaction.method,
    payment_detail: transaction.payment_detail ? JSON.parse(transaction.payment_detail) : {},
    paid_at: transaction.paid_at,
  };

  try {
    // Buat raw body string SEKALI — gunakan string yang sama untuk signing DAN mengirim
    // Ini memastikan HMAC di Node.js == HMAC yang diverifikasi PHP dari raw HTTP body
    const rawBody = JSON.stringify(payload);
    const signature = generateSignature(rawBody, merchant.api_key);
    
    console.log(`Mengirim callback ke ${merchant.callback_url} untuk transaksi ${transaction.id}`);
    
    await axios.post(merchant.callback_url, rawBody, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      timeout: 5000,
    });

    console.log(`Callback berhasil dikirim ke ${merchant.callback_url}`);
  } catch (err) {
    const status = err.response?.status || 'N/A';
    const responseData = err.response?.data ? JSON.stringify(err.response.data) : 'No response body';
    console.error(`Callback gagal ke ${merchant.callback_url}: ${err.message} (HTTP ${status})`);
    console.error(`  Response: ${responseData}`);
  }
}

module.exports = { verifyPayment, sendCallback, generateSignature };
