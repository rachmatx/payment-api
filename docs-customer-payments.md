# Customer payment simulator contract

Stage 3 local implementation. This is a simulator, not a bank gateway. Create returns
SIMULATION mode and only transaction UUID QR / dummy bank details. Existing configured
merchant QR/account data are not exposed by the new transaction presentation.

- POST /api/transactions supports Idempotency-Key, scoped to merchant. Same key and
  same payload returns the same invoice; different payload is 409.
- GET /:id/status and POST /:id/cancel return signed current state. A paid invoice
  stays SUCCESS when cancelled. Expired/cancelled invoices cannot be paid/confirmed.
- Create/status/cancel/pay responses use X-Webhook-Signature = HMAC-SHA256 of the exact
  response envelope with the merchant's separate webhook_secret. Callback requests
  use X-Signature. The merchant API key is not a signing key.
- Conditional SQLite updates serialize pay/cancel races. Callback delivery is best
  effort; durable retry/outbox is not implemented. Laundry signed status reconciliation
  recovers lost delivery while the customer page is active.
- Existing Smart Pay UUID/nota lookup remains supported. No new Smart Pay code ships.

Configure API_KEY and PAYMENT_WEBHOOK_SECRET (different values), CALLBACK_URL and a
persistent DB_FILE. Existing M1 credentials are preserved when env is absent; explicitly
setting env updates them. DB_FILE defaults to the existing src/db/database.sqlite path
for compatibility. Tests always use disposable databases, never that tracked database.
Node 24 uses node:sqlite, Node 20 retains the sqlite/sqlite3 adapter. `npm ci` must run
native dependency install scripts for Node 20. Tests here ran on Node 24.

Run `npm test` (17 HTTP/unit/migration tests). Paired Flutter opt-in integration also tests the
actual Express → Laundry signed response contract without external services. Do not
activate for real payments. Stage 4 notifications/redemption has not been implemented.
