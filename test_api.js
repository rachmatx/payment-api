const { getDb } = require('./src/db');
const axios = require('axios');

async function runTest() {
  const db = await getDb();
  
  // 1. Insert Merchant
  await db.run(`INSERT OR IGNORE INTO merchants (id, name, api_key, callback_url, qris_data, bank_name, account_number, account_holder) 
                VALUES ('merchant-laundry', 'Sparkleen Laundry', 'LAUNDRY-SECRET-KEY', 'http://localhost:8080/webhook/payment', 'DUMMY-QRIS', 'BCA', '12345678', 'Sparkleen')`);

  console.log('Merchant inserted');
  
  // 2. Test Create Transaction
  try {
    const res = await axios.post('http://localhost:3000/api/transactions', {
      amount: 50000,
      method: 'QRIS',
      customer_ref: 'TRX-123'
    }, {
      headers: { 'X-Api-Key': 'LAUNDRY-SECRET-KEY' }
    });
    
    console.log('Create Transaction Success:', res.data);
    
    const trxId = res.data.data.transaction_id;
    
    // 3. Test Confirm
    const confirmRes = await axios.post(`http://localhost:3000/api/transactions/${trxId}/confirm`, {}, {
      headers: { 'X-Api-Key': 'LAUNDRY-SECRET-KEY' }
    });
    
    console.log('Confirm Success:', confirmRes.data);
    
  } catch (err) {
    console.error('Test Error:', err.response ? err.response.data : err.message);
  }
}

runTest();
