# Sparkleen Payment API (Node.js)

A lightweight and robust Express.js REST API serving as a middleware bridge between the **Sparkleen Laundry (CodeIgniter 4)** main application and the **Smart Pay (Flutter)** mobile application.

This API acts as a secure queue and verification center for all digital transactions (QRIS and Bank Transfers).

---

## Core Features
1. **Transaction Bridging**: Receives pending transaction data from the CodeIgniter server and holds it securely.
2. **Mobile App Serving**: Serves pending transaction details to the Flutter mobile app when the user scans a QR Code or types a manual bill amount.
3. **Automated Callbacks**: Upon successful payment via the mobile app, this API automatically pings the CodeIgniter Webhook to finalize the transaction status in the primary database.
4. **Metadata Support**: Capable of storing dynamic metadata (such as `payment_detail`) to attach unique customer references to each transaction.
5. **SQLite Ephemeral Storage**: Designed to use a lightweight local SQLite database (`database.sqlite`) which acts as a temporary holding area for active transactions.

---

## System Requirements
- **Node.js** version 18.x or higher.
- **npm** (Node Package Manager).

---

## Installation & Setup

### Local Development
1. **Clone the Repository**:
   ```bash
   git clone <repo-url> && cd payment_api
   ```
2. **Install Dependencies**:
   ```bash
   npm install
   ```
3. **Environment Setup**:
   Copy the example environment file and configure it:
   ```bash
   cp .env.example .env
   ```
4. **Run the Server**:
   ```bash
   npm start
   ```
   *The server will run by default on `http://localhost:3000`.*

### Deployment (Railway / Cloud)
This API is highly optimized for deployment on platforms like Railway. 
When deploying, make sure to configure the following Environment Variables in your Railway Dashboard:

- `API_KEY`: The master secret key. **MUST EXACTLY MATCH** the `apiKey` configured in both the CodeIgniter `.env` and the Flutter `merchant_config.dart`. (Default fallback: `my-super-secret-key-123`).
- `CALLBACK_URL`: The production URL of your CodeIgniter webhook (e.g., `https://sparkleen.rachmatx.me/webhook/payment`).
- `PORT`: (Automatically assigned by Railway).

---

## Security & Architecture

This API is intentionally designed to be stateless regarding permanent data. The SQLite database serves only to queue pending bills and temporarily log completed transactions. The single source of truth for the business remains the CodeIgniter MySQL database. 

Ensure that your `API_KEY` is kept secret and is never exposed in client-side web code. The Flutter app obfuscates this key within its compiled Dart code.

---

## API Endpoints

### 1. Create Transaction (Used by CodeIgniter)
**POST** `/api/transactions`
- Headers: `x-api-key`
- Body: `transaction_id`, `amount`, `method`, `customer_ref`, `metadata`

### 2. Search Transaction (Used by Flutter App)
**GET** `/api/transactions/find-transfer-target`
- Query Params: `amount`, `method`
- Returns: Matching pending transaction to be paid.

### 3. Retrieve Single Transaction (Used by Flutter App)
**GET** `/api/transactions/:id`
- Headers: `x-api-key`
- Returns: Transaction details for a specific QR Code ID.

### 4. Process Payment (Used by Flutter App)
**POST** `/api/transactions/:id/pay`
- Headers: `x-api-key`
- Body: `paid_amount`, `method`
- Action: Marks transaction as SUCCESS and triggers Webhook to CodeIgniter.
