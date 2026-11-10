const express = require('express');
const router = express.Router();
const { randomUUID } = require('node:crypto');
const { getDb } = require('../db');
const { authenticateMerchant, requireCallbackSigning } = require('../middleware/auth');
const { verifyPayment, sendCallback } = require('../services/paymentService');
const { isValidAmount } = require('../services/paymentCallback');
const { simulationDetails, presentation, signedResponse } = require('../services/mobilePayment');

router.post('/', authenticateMerchant, requireCallbackSigning, async (req, res) => {
  const { amount, method, customer_ref } = req.body || {};
  const merchant = req.merchant;
  const requestKey = req.get('Idempotency-Key') || null;
  if (!isValidAmount(amount) || !['QRIS', 'BANK_TRANSFER'].includes(method)
      || typeof customer_ref !== 'string' || !customer_ref.trim() || customer_ref.length > 100
      || customer_ref.trim() !== customer_ref || (requestKey && !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey))) {
    return res.status(400).json({ success: false, error: 'Data tagihan tidak valid' });
  }
  try {
    const db = await getDb();
    const id = randomUUID();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const detail = simulationDetails({ id, method }, merchant);
    const inserted = await db.run(`INSERT INTO transactions (id, merchant_id, amount, method, status, customer_ref, idempotency_key, payment_detail, expired_at)
      VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?) ON CONFLICT(merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [id, merchant.id, amount, method, customer_ref, requestKey, JSON.stringify(detail), expiry]);
    const transaction = requestKey
      ? await db.get('SELECT * FROM transactions WHERE merchant_id = ? AND idempotency_key = ?', [merchant.id, requestKey])
      : await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (transaction.amount !== amount || transaction.method !== method || transaction.customer_ref !== customer_ref) {
      return res.status(409).json({ success: false, error: 'Idempotency key dipakai untuk tagihan berbeda' });
    }
    return signedResponse(res, inserted.changes ? 201 : 200, transaction, merchant);
  } catch { return res.status(500).json({ success: false, error: 'Gagal menyiapkan tagihan' }); }
});

async function findTransaction(db, id, merchantId) {
  return db.get('SELECT * FROM transactions WHERE (id = ? OR customer_ref = ?) AND merchant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [id, id, merchantId]);
}

async function settle(req, res) {
  try {
    const db = await getDb();
    const transaction = await findTransaction(db, req.params.id, req.merchant.id);
    if (!transaction) return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    if (presentation(transaction, req.merchant).status === 'EXPIRED') return res.status(410).json({ success: false, error: 'Transaksi kedaluwarsa' });
    const verified = await verifyPayment(transaction.id); // Still explicitly a simulator.
    if (verified.alreadyProcessed || !verified.isSuccess) return res.status(409).json({ success: false, error: 'Transaksi sudah diproses' });
    const now = new Date().toISOString();
    const result = await db.run("UPDATE transactions SET status = 'SUCCESS', paid_at = ? WHERE id = ? AND status = 'PENDING' AND expired_at > ?", [now, transaction.id, now]);
    if (!result.changes) return res.status(409).json({ success: false, error: 'Status tagihan sudah berubah' });
    const updated = await db.get('SELECT * FROM transactions WHERE id = ?', [transaction.id]);
    void sendCallback(updated, req.merchant);
    return signedResponse(res, 200, updated, req.merchant);
  } catch { return res.status(500).json({ success: false, error: 'Gagal memproses pembayaran' }); }
}
router.post('/:id/pay', authenticateMerchant, requireCallbackSigning, settle);
router.post('/:id/confirm', authenticateMerchant, requireCallbackSigning, settle);
router.post('/:id/cancel', authenticateMerchant, requireCallbackSigning, async (req, res) => {
  try {
    const db = await getDb();
    const transaction = await findTransaction(db, req.params.id, req.merchant.id);
    if (!transaction) return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    await db.run("UPDATE transactions SET status = 'CANCELLED' WHERE id = ? AND status = 'PENDING'", [transaction.id]);
    return signedResponse(res, 200, await db.get('SELECT * FROM transactions WHERE id = ?', [transaction.id]), req.merchant);
  } catch { return res.status(500).json({ success: false, error: 'Pembatalan belum terkonfirmasi' }); }
});
router.get('/:id/status', authenticateMerchant, requireCallbackSigning, async (req, res) => {
  try {
    const transaction = await findTransaction(await getDb(), req.params.id, req.merchant.id);
    if (!transaction) return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    return signedResponse(res, 200, transaction, req.merchant);
  } catch { return res.status(500).json({ success: false, error: 'Status belum dapat diperiksa' }); }
});
router.get('/', authenticateMerchant, async (req, res) => {
  const rows = await (await getDb()).all('SELECT id, amount, method, status, created_at, paid_at FROM transactions WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 10', [req.merchant.id]);
  res.json({ success: true, data: rows });
});

router.post('/find-transfer-target', authenticateMerchant, async (req, res) => {
  const { amount, bank_name, account_number } = req.body;
  
  if (!amount || !bank_name || !account_number) {
    return res.status(400).json({ success: false, error: 'Data transfer tidak lengkap' });
  }

  try {
    const db = await getDb();
    
    // Cari transaksi PENDING yang sesuai metode BANK_TRANSFER
    const pendingTrans = await db.all(
      `SELECT * FROM transactions WHERE method = 'BANK_TRANSFER' AND status = 'PENDING' AND merchant_id = ? ORDER BY created_at DESC`,
      [req.merchant.id]
    );

    let matchedTx = null;
    for (const t of pendingTrans) {
      if (t.payment_detail) {
        try {
          const detail = JSON.parse(t.payment_detail);
          const nameMatch = detail.bank_name.toLowerCase().includes(bank_name.toLowerCase()) || bank_name.toLowerCase().includes(detail.bank_name.toLowerCase());
          if (nameMatch && detail.account_number === account_number && parseFloat(t.amount) === parseFloat(amount)) {
            matchedTx = t;
            break;
          }
        } catch (e) {}
      }
    }

    if (!matchedTx) {
      return res.status(404).json({ success: false, error: 'Tidak ditemukan tagihan yang cocok dengan data transfer ini' });
    }

    res.json({ 
      success: true, 
      data: {
        id: matchedTx.id,
        transaction_id: matchedTx.id,
        status: matchedTx.status,
        amount: matchedTx.amount,
        method: matchedTx.method,
        payment_detail: matchedTx.payment_detail
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
