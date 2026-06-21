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
      'SELECT * FROM transactions WHERE (id = ? OR customer_ref = ?) AND merchant_id = ? ORDER BY created_at DESC LIMIT 1', 
      [id, id, merchant.id]
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
      await db.run('UPDATE transactions SET status = ? WHERE id = ?', ['EXPIRED', transaction.id]);
      return res.status(410).json({ success: false, error: 'Transaksi sudah expired' });
    }

    const { alreadyProcessed, isSuccess } = await verifyPayment(transaction.id);

    if (alreadyProcessed) {
      return res.status(409).json({ success: false, error: 'Sudah diproses' });
    }

    if (isSuccess) {
      const paidAt = new Date().toISOString();
      await db.run(
        'UPDATE transactions SET status = ?, paid_at = ? WHERE id = ?', 
        ['SUCCESS', paidAt, transaction.id]
      );
      
      const updatedTrx = await db.get('SELECT * FROM transactions WHERE id = ?', [transaction.id]);
      sendCallback(updatedTrx, merchant);

      return res.json({
        success: true,
        data: {
          transaction_id: transaction.id,
          status: 'SUCCESS',
          amount: transaction.amount,
          method: transaction.method,
          paid_at: paidAt,
        }
      });
    } else {
      await db.run('UPDATE transactions SET status = ? WHERE id = ?', ['FAILED', transaction.id]);
      return res.status(402).json({ success: false, error: 'Pembayaran gagal diverifikasi' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/', authenticateMerchant, async (req, res) => {
  try {
    const db = await getDb();
    const transactions = await db.all(
      'SELECT id, amount, method, status, created_at, paid_at FROM transactions WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 10',
      [req.merchant.id]
    );
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/status', authenticateMerchant, async (req, res) => {
  try {
    const db = await getDb();
    const transaction = await db.get(
      'SELECT id, amount, method, status, payment_detail, paid_at, expired_at FROM transactions WHERE (id = ? OR customer_ref = ?) AND merchant_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id, req.params.id, req.merchant.id]
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
    const transaction = await db.get(
      'SELECT * FROM transactions WHERE (id = ? OR customer_ref = ?) AND merchant_id = ? ORDER BY created_at DESC LIMIT 1', 
      [id, id, req.merchant.id]
    );

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    }
    if (transaction.status !== 'PENDING') {
      return res.status(409).json({ success: false, error: `Transaksi sudah berstatus ${transaction.status}` });
    }

    const paidAt = new Date().toISOString();
    await db.run(
      'UPDATE transactions SET status = ?, paid_at = ? WHERE id = ?', 
      ['SUCCESS', paidAt, transaction.id]
    );

    const merchant = await db.get('SELECT * FROM merchants WHERE id = ?', [transaction.merchant_id]);
    sendCallback({ ...transaction, status: 'SUCCESS', paid_at: paidAt }, merchant);

    res.json({ success: true, message: 'Dikonfirmasi manual', transaction_id: transaction.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
