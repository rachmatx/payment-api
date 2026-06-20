require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');
const transactionRoutes = require('./routes/transactions');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/transactions', transactionRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Payment API is running' });
});

async function startServer() {
  try {
    await getDb(); // Initialize database
    console.log('Database initialized successfully');
    
    app.listen(PORT, () => {
      console.log(`Payment API Service listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
