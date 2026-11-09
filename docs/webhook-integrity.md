# Callback pembayaran yang terikat ke intent Laundry

10 November 2026. Branch pasangan: `feat/payment-webhook-integrity` pada Payment
API dan Laundry. Ini penguatan kontrak/penerimaan callback, bukan integrasi bank
atau penggantian verifikasi simulasi yang sudah ada.

POST pembuatan tagihan sekarang menerima `amount` berupa JSON positive safe integer
serta `customer_ref` nonkosong. Respons menambahkan `merchant_id` dan `customer_ref`
untuk disimpan bersama intent Laundry. Method tetap QRIS/BANK_TRANSFER.

Callback menambahkan `customer_ref` dan `status: SUCCESS`; payload hanya dibentuk
untuk transaction SUCCESS dengan merchant yang cocok. Nominal, metode dan paid_at
berasal dari transaksi gateway. HMAC dan HTTP memakai string JSON yang sama.
Pengirim tidak lagi menulis body respons callback atau materi signature ke log.

Signing memakai `merchants.webhook_secret`, terpisah dari API key merchant.
Atur `PAYMENT_WEBHOOK_SECRET` secara privat pada kedua server untuk merchant
M1 default. Merchant lain memerlukan provisioning secret per merchant pada server.
SQLite existing mendapat kolom nullable secara additive; secret tidak disalin dari
API key. Key yang sama dengan API key ditolak. Create/pay/confirm dengan callback
aktif dan secret yang belum dikonfigurasi ditolak 503 sebelum mengubah pembayaran.
Secret tidak pernah dikirim ke respons API atau dimasukkan ke klien Smart Pay.

Laundry mencocokkan callback ke intent yang sudah tersimpan: gateway id, merchant,
nota, nominal integer dan metode. Status SUCCESS wajib. Callback ganda menghasilkan
200 duplicate tanpa insert ledger lagi; pembayaran parsial tidak dianggap lunas.
Callback tidak cocok/saldo berubah ditolak 409 untuk rekonsiliasi, bukan diisi
ulang otomatis berdasarkan sisa tagihan. Lihat dokumen Laundry
`docs/payments/webhook-integrity.md` untuk respons serta migrasi DB penerima.

## Uji hermetik

```sh
npm test
```

Diverifikasi dengan Node 24.22.1. Test migrasi menggunakan `node:sqlite` in-memory
(Node 24 direkomendasikan untuk menjalankan suite); aplikasi production tetap
menggunakan adapter sqlite3 existing. Memakai transport yang diinjeksi, tanpa membuka file
SQLite yang ada, menghubungi gateway, atau memerlukan merchant operasional.

## Uji Node → HTTP PHP → MariaDB lokal

Siapkan backend Laundry yang berpasangan, PHP dan database disposable lokal
`laundry_db_test`. Tidak boleh menggunakan database operasional.

1. Jalankan server CodeIgniter dalam mode testing di loopback dengan environment
   `PAYMENT_WEBHOOK_SECRET=webhook-http-test-key`:
   `CI_ENVIRONMENT=testing php -S 127.0.0.1:42526 -t public public/index.php`.
2. Di checkout Payment API, atur environment:

   ```sh
   export LAUNDRY_TEST_URL=http://127.0.0.1:42526
   export LAUNDRY_TEST_ROOT=/absolute/path/to/sparkleen-laundry
   export TEST_PHP_BIN=/absolute/path/to/php
   npm run test:integration
   ```

   PowerShell memakai `$env:NAMA='nilai'` untuk tiap variable.
3. Script sengaja mereset fixture Laundry lokal melalui CLI yang dijaga; ia menguji
   body palsu, nominal salah, callback valid dan replay. Jumlah ledger akhir harus
   satu dengan nominal Rp35.000 serta status lunas.

Uji HTTP memakai helper callback yang sama dengan pengirim, dengan fetch sebagai
transport test. Tidak menjalankan route Express/SQLite lengkap atau verifikasi
provider. Wrapper production menginjeksi Axios ke helper yang sama.

## Batas penerapan

Laundry lama belum memverifikasi field baru; Laundry baru menolak respons gateway
versi lama yang tidak memiliki merchant/customer_ref. Jeda pembayaran selama rollout
berpasangan, migrasikan intent dan secret server, lalu rekonsiliasi tagihan lama
tanpa menebak nominal. Backup SQLite aktual sebelum startup versi baru mengubah
skema; Docker production Node 20/adapter sqlite3 belum dibangun ulang dalam sesi ini.

Pengiriman masih tidak memiliki persistent retry/outbox. Kegagalan callback tidak
membatalkan status SUCCESS di gateway dan harus direkonsiliasi. Merchant auth dan
verifikasi pembayaran/saldo masih memakai mekanisme/simulasi lama. Koneksi tersebut
belum boleh dinyatakan siap untuk transaksi uang nyata hanya karena test callback lulus.
Tidak ada deploy atau push pada tahap ini.

## Hasil pada 10 November 2026

- 8 test Node lulus pada Node 24.22.1, termasuk migrasi nullable/idempotent SQLite
  in-memory dan penolakan penggunaan API key merchant sebagai key webhook.
- Laundry pasangan: 119 test, 496 assertions lulus, termasuk 13 test webhook.
- Uji HTTP Node → CodeIgniter → MariaDB lulus: request palsu/nominal salah tidak
  mengubah ledger; callback valid dan replay menghasilkan satu pembayaran Rp35.000.
- JavaScript syntax/whitespace lulus. Tidak menjalankan SQLite existing, provider
  pembayaran nyata atau Docker produksi; tidak ada push/deploy.
