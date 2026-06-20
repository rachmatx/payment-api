const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { authenticateMerchant } = require('../middleware/auth');
const { verifyPayment, sendCallback } = require('../services/paymentService');

router.post('/', authenticateMerchant, async (req, res) => {
  const { amount, method, customer_ref } = req.body;
  const merchant = req.merchant;

  if (!amount || amount <= 0) {
    return res.status(400).json({ success: false, error: 'Amount tidak valid' });
  }
  if (!['QRIS', 'BANK_TRANSFER'].includes(method)) {
    return res.status(400).json({ success: false, error: 'Method harus QRIS atau BANK_TRANSFER' });
  }

  let paymentDetail;
  if (method === 'QRIS') {
    paymentDetail = {
      qris_data: merchant.qris_data || `QRIS-DUMMY-${merchant.id}`,
      merchant_name: merchant.name,
    };
  } else {
    paymentDetail = {
      bank_name: merchant.bank_name || 'Bank Dummy',
      account_number: merchant.account_number || '123456789',
      account_holder: merchant.account_holder || merchant.name,
    };
  }

  const transactionId = uuidv4();
  const expiredAt = new Date(Date.now() + 15 * 60 * 1000);

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO transactions 
       (id, merchant_id, amount, method, status, customer_ref, payment_detail, expired_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [transactionId, merchant.id, amount, method, customer_ref, 
       JSON.stringify(paymentDetail), expiredAt.toISOString()]
    );

    res.status(201).json({
      success: true,
      data: {
        transaction_id: transactionId,
        amount,
        method,
        payment_detail: paymentDetail,
        expired_at: expiredAt,
        status: 'PENDING',
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/pay', authenticateMerchant, async (req, res) => {
  const { id } = req.params;
  const merchant = req.merchant;

  try {
    const db = await getDb();
    const transaction = await db.get(
      'SELECT * FROM transactions WHERE id = ? AND merchant_id = ?', 
      [id, merchant.id]
    );

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    }
    if (transaction.status !== 'PENDING') {
      return res.status(409).json({ 
        success: false, 
        error: `Transaksi sudah berstatus ${transaction.status}` 
      });
    }
    if (new Date() > new Date(transaction.expired_at)) {
      await db.run('UPDATE transactions SET status = ? WHERE id = ?', ['EXPIRED', id]);
      return res.status(410).json({ success: false, error: 'Transaksi sudah expired' });
    }

    const { alreadyProcessed, isSuccess } = await verifyPayment(id);

    if (alreadyProcessed) {
      return res.status(409).json({ success: false, error: 'Sudah diproses' });
    }

    if (isSuccess) {
      const paidAt = new Date().toISOString();
      await db.run(
        'UPDATE transactions SET status = ?, paid_at = ? WHERE id = ?', 
        ['SUCCESS', paidAt, id]
      );
      
      const updatedTrx = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
      sendCallback(updatedTrx, merchant);

      return res.json({
        success: true,
        data: {
          transaction_id: id,
          status: 'SUCCESS',
          amount: transaction.amount,
          method: transaction.method,
          paid_at: paidAt,
        }
      });
    } else {
      await db.run('UPDATE transactions SET status = ? WHERE id = ?', ['FAILED', id]);
      return res.status(402).json({ success: false, error: 'Pembayaran gagal diverifikasi' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/status', authenticateMerchant, async (req, res) => {
  try {
    const db = await getDb();
    const transaction = await db.get(
      'SELECT id, amount, method, status, paid_at, expired_at FROM transactions WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.merchant.id]
    );

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    }

    res.json({ success: true, data: transaction });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/confirm', authenticateMerchant, async (req, res) => {
  const { id } = req.params;
  
  try {
    const db = await getDb();
    const transaction = await db.get('SELECT * FROM transactions WHERE id = ? AND merchant_id = ?', [id, req.merchant.id]);

    if (!transaction || transaction.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: 'Tidak bisa dikonfirmasi' });
    }

    const paidAt = new Date().toISOString();
    await db.run(
      'UPDATE transactions SET status = ?, paid_at = ? WHERE id = ?', 
      ['SUCCESS', paidAt, id]
    );

    const merchant = await db.get('SELECT * FROM merchants WHERE id = ?', [transaction.merchant_id]);
    sendCallback({ ...transaction, status: 'SUCCESS', paid_at: paidAt }, merchant);

    res.json({ success: true, message: 'Dikonfirmasi manual', transaction_id: id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
