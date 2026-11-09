const axios = require('axios');
const { getDb } = require('../db');
const { generateSignature, deliverCallback } = require('./paymentCallback');

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

async function sendCallback(transaction, merchant) {
  return deliverCallback(transaction, merchant, (url, body, options) => axios.post(url, body, options));
}

module.exports = { verifyPayment, sendCallback, generateSignature };
