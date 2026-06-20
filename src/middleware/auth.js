const { getDb } = require('../db');

async function authenticateMerchant(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ 
      success: false, 
      error: 'API key wajib disertakan di header X-Api-Key' 
    });
  }

  try {
    const db = await getDb();
    const merchant = await db.get(
      'SELECT * FROM merchants WHERE api_key = ?', 
      [apiKey]
    );

    if (!merchant) {
      return res.status(403).json({ 
        success: false, 
        error: 'API key tidak valid' 
      });
    }

    req.merchant = merchant;
    next();
  } catch (err) {
    console.error('Auth Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { authenticateMerchant };
