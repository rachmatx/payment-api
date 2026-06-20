const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');

let dbInstance = null;

async function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await open({
    filename: path.join(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });

  // Execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await dbInstance.exec(schema);

  // Auto-seed default merchant if not exists
  const defaultApiKey = process.env.API_KEY || 'my-super-secret-key-123';
  const callbackUrl = process.env.CALLBACK_URL || 'https://sparkleen.rachmatx.me/webhook/payment';
  
  const row = await dbInstance.get('SELECT * FROM merchants WHERE id = ?', ['M1']);
  if (!row) {
    await dbInstance.run(
      `INSERT INTO merchants (id, name, api_key, callback_url, qris_data, bank_name, account_number, account_holder) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['M1', 'Sparkleen Laundry', defaultApiKey, callbackUrl, '00020101021226570011ID.ESPAY.WWW01180000000000000000000214202111080000000303UMI51440014ID.CO.QRIS.WWW0215ID10200210351330303UMI5204581253033605802ID5917SPARKLEEN LAUNDRY6011DKI JAKARTA61051021062380114000000000000000703A010804S00163045E16', 'Bank BCA', '1234567890', 'Sparkleen']
    );
    console.log('Seeded default merchant with env API_KEY and CALLBACK_URL');
  } else {
    // Update existing merchant just in case keys or callback changed
    await dbInstance.run(
      `UPDATE merchants SET api_key = ?, callback_url = ? WHERE id = ?`,
      [defaultApiKey, callbackUrl, 'M1']
    );
    console.log('Updated default merchant with env API_KEY and CALLBACK_URL');
  }

  return dbInstance;
}

module.exports = { getDb };
