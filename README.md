# Panduan Integrasi: Payment API (Microservice)

Dokumen ini adalah panduan komprehensif untuk menginstal, mengatur, dan mengintegrasikan sistem **Payment API** ke dalam proyek aplikasi Anda (seperti Sistem Kasir, Toko Online, dsb). 

Payment API dibangun sebagai *Microservice* terpisah (menggunakan Node.js & SQLite). Tujuannya adalah menjadi layanan mandiri yang mengelola pembuatan tagihan dan mengirimkan notifikasi lunas (*Webhook*) ke aplikasi utama Anda.

---

## 1. Konsep Dasar (Bagaimana Cara Kerjanya?)

Agar lebih mudah dimengerti, bayangkan API ini sebagai "Kasir Virtual" pihak ketiga (seperti Midtrans atau Xendit).
1. **Aplikasi Anda (Misal: Web CodeIgniter)** mengirimkan instruksi ke **Payment API** (Contoh: "Buatkan tagihan Rp 50.000 untuk transaksi 001").
2. **Payment API** menyimpan tagihan tersebut dan mengembalikan "ID Transaksi API" beserta data pembayaran (gambar QRIS / Nomor Rekening).
3. **Pelanggan** membayar menggunakan e-wallet (seperti aplikasi Sparkleen Pay) atau *mobile banking*.
4. Setelah pelanggan sukses bayar, **Payment API** secara otomatis menembak sebuah pesan tersembunyi ke URL aplikasi Anda (*Webhook*) untuk memberitahu: "Hei, tagihan 001 sudah lunas!".
5. **Aplikasi Anda** menerima pesan tersebut, memverifikasinya, dan mengubah status transaksi di database Anda menjadi Lunas.

---

## 2. Cara Menjalankan API & Mendapatkan API Key

Karena Payment API adalah aplikasi Node.js yang berdiri sendiri, Anda harus menyalakannya secara terpisah dari aplikasi web utama (PHP) Anda.

### A. Persiapan dan Instalasi
1. Buka folder `payment_api` menggunakan Terminal atau *Command Prompt*.
2. Jalankan perintah instalasi pustaka:
   ```bash
   npm install
   ```
3. Ubah nama file `.env.example` menjadi `.env` (jika ada), lalu atur port dan *Callback URL* (*Webhook*) jika diperlukan:
   ```ini
   PORT=3000
   CALLBACK_URL=http://localhost/laundry_app/public/webhook/payment
   ```
   > [!TIP]
   > Variabel `CALLBACK_URL` di `.env` (jika diisi) akan otomatis mengganti URL Webhook pada database `merchants` setiap kali API dinyalakan ulang. Ini sangat berguna jika Anda berpindah-pindah lingkungan pengembangan (Lokal vs Cloud) tanpa harus repot mengedit database SQLite.

### B. Mendapatkan API Key & Mengatur URL Webhook (Database Seed)
API ini menggunakan database SQLite (`src/db/database.sqlite`). Untuk bisa menggunakannya, Anda butuh entitas *Merchant* (Toko) yang memiliki **API Key** unik.
Di dalam proyek ini, sudah disediakan script untuk mengisi data percobaan (*seed*).
1. Buka file `src/db/seed.js` (atau jalankan perintah *seed* yang disediakan). Di sana terdapat kode untuk mendaftarkan toko Anda:
   ```javascript
   db.run("INSERT INTO merchants (id, name, api_key, callback_url, qris_data, bank_name, account_number, account_holder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", 
   ['M1', 'Toko Anda', 'API-KEY-123', 'http://localhost/proyek_anda/webhook', ...]);
   ```
2. Dari kode di atas:
   - **API Key** Anda adalah `API-KEY-123`. Ini ibarat kata sandi untuk berkomunikasi dengan API.
   - **Callback URL (Webhook)** adalah alamat di web PHP Anda yang akan menerima pesan saat lunas. **PENTING:** Sesuaikan URL ini dengan *localhost* atau domain asli web Anda.
3. Jalankan API Server Anda:
   ```bash
   npm start
   ```
   *Biarkan terminal ini tetap terbuka agar API bisa terus menerima permintaan.*

---

## 3. Cara Integrasi di Sisi Aplikasi Anda (Backend PHP)

Sekarang Payment API Anda berjalan di `http://localhost:3000`. Saatnya menghubungkan Web Utama (PHP/CodeIgniter) Anda.

### A. Pengaturan Environment (Variabel Lingkungan)
Di aplikasi PHP Anda (misal CodeIgniter), buka file `.env` Anda dan tambahkan kredensial API:
```ini
# URL menuju API Node.js yang baru saja Anda nyalakan
PAYMENT_API_URL = 'http://localhost:3000/api/transactions'
# API Key yang Anda dapatkan dari database Payment API tadi
PAYMENT_API_KEY = 'API-KEY-123'
```

### B. Mengirim Permintaan Tagihan
Saat kasir Anda menekan tombol "Proses Pembayaran", backend PHP harus mengirim `POST` ke Node.js API:

**Kode PHP (cURL atau Guzzle):**
```php
$payload = [
    'amount' => 50000,
    'method' => 'QRIS', // atau BANK_TRANSFER
    'customer_ref' => 'TRX-001'
];

$ch = curl_init(getenv('PAYMENT_API_URL'));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'x-api-key: ' . getenv('PAYMENT_API_KEY') // Autentikasi!
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));

$response = curl_exec($ch);
$result = json_decode($response, true);

// Jika sukses, API mengembalikan ID khusus. 
// Simpan $result['data']['transaction_id'] ke database Anda.
```

---

## 4. Menerima Notifikasi Pembayaran (Webhook)

Inilah bagian "Real-Time". Saat pelanggan sukses membayar, Node.js API menembak URL Webhook Anda.

> [!WARNING]
> Webhook ini dilakukan antar Server (*Server-to-Server*). Pastikan fitur perlindungan **CSRF (Cross-Site Request Forgery)** pada framework Anda dimatikan **khusus untuk rute webhook ini**.

### Mencegah Hacker (Verifikasi Signature)
Untuk memastikan pesan webhook itu benar-benar dari Node.js API Anda dan bukan hacker, API mengirimkan "Tanda Tangan" (`X-Signature`).

> [!CAUTION]
> **KESALAHAN UMUM:** Jangan mem-parsing JSON menjadi *array* lalu di-encode kembali dengan `json_encode()` saat mencocokkan *signature*. Format spasi di PHP berbeda dengan Node.js. Gunakan *Raw Body String* secara mentah!

**Contoh Penerima Webhook (CodeIgniter / PHP):**
```php
// 1. Dapatkan string mentah
$rawBody = $this->request->getBody(); // atau file_get_contents('php://input');

// 2. Ambil tanda tangan dari Header
$signature = $this->request->getHeaderLine('X-Signature');
$secret = getenv('PAYMENT_API_KEY'); 

// 3. Hitung ulang tanda tangan
$expectedSignature = hash_hmac('sha256', $rawBody, $secret);

// 4. Tolak jika tidak sama
if (!hash_equals($expectedSignature, $signature)) {
    return $this->failUnauthorized('Invalid signature');
}

// 5. Ubah database jika aman!
$data = json_decode($rawBody, true);
if ($data['event'] === 'payment.success') {
    // Lakukan aksi: UPDATE tabel_transaksi SET status = 'Lunas' WHERE api_id = $data['transaction_id'];
}
```

---

## 5. Integrasi di Sisi Frontend (Memuat Ulang Layar Otomatis)

Meskipun database Anda sudah "Lunas" karena ditebak oleh Webhook, halaman web Kasir Anda tidak akan tahu karena ia statis. Kita butuh sedikit trik Javascript (Polling) untuk bertanya ke server.

1. **Buat Endpoint Sederhana di Backend Anda:**
   Buat URL seperti `/transaksi/cek_status_bayar/001` yang hanya membalas JSON sederhana: `{"sisa_tagihan": 0}`.
   
2. **Pasang Script ini di Halaman HTML/View Kasir Anda:**
```javascript
// Cek ke server setiap 3 detik
let interval = setInterval(function() {
    fetch('/transaksi/cek_status_bayar/001')
        .then(response => response.json())
        .then(data => {
            if(data.sisa_tagihan <= 0) {
                clearInterval(interval);
                // Tampilkan SweetAlert yang keren
                Swal.fire({
                    title: 'Pembayaran Berhasil!',
                    text: 'Uang telah masuk ke sistem secara otomatis.',
                    icon: 'success',
                    confirmButtonText: 'OK'
                }).then(() => {
                    // Muat ulang layar kasir
                    window.location.reload(); 
                });
            }
        });
}, 3000);
```

---

## 🚀 Fitur & Pembaruan Terkini (Changelog)

1. **Dynamic Callback URL**: Penambahan fitur pembacaan URL Webhook dinamis langsung dari _Environment Variable_ (`CALLBACK_URL`). Mempermudah _deployment_ Railway/Vercel karena developer tak perlu meng-_update_ tabel `merchants` di dalam SQLite secara manual saat alamat aplikasi utama (PHP) berubah-ubah. API akan secara otomatis memperbarui URL pada *database* saat inisiasi server.

Dengan langkah-langkah di atas, aplikasi Anda akan beroperasi seakan-akan terhubung langsung dengan sistem pembayaran kelas atas seperti yang digunakan di minimarket!

---

## 6. Cara Deploy ke Server (Railway via Docker)

Karena Anda akan mendeploy *Payment API* ini ke layanan Railway, konfigurasi khusus Docker sudah dipersiapkan di dalam folder ini. Railway akan membaca `Dockerfile` dan secara otomatis membuatkan lingkungan yang aman untuk aplikasi berjalan.

### Langkah 1: Push ke GitHub (atau GitLab)
Pastikan folder `payment_api` telah diunggah ke repositori GitHub pribadi/publik Anda. File lokal seperti `node_modules/` dan `database.sqlite` akan diabaikan karena konfigurasi `.dockerignore` telah kita buat.

### Langkah 2: Deploy di Railway
1. Login ke [Railway.app](https://railway.app).
2. Buat proyek baru (*New Project* -> *Deploy from GitHub repo*).
3. Pilih repositori GitHub tempat `payment_api` berada.
4. Railway akan mulai mem-build aplikasi berdasarkan `Dockerfile` secara otomatis.

### Langkah 3: Konfigurasi Environment Variables di Railway
Aplikasi Anda akan error di awal karena Railway belum tahu API Key apa yang dipakai.
1. Di halaman project Railway, klik aplikasi `payment_api`.
2. Masuk ke tab **Variables**.
3. Tambahkan variabel berikut:
   - `PORT` = `3000` *(Opsional, biasanya Railway inject ini otomatis)*
   - `API_KEY` = `(Isi dengan kunci yang persis sama dengan .env di Sparkleen Anda)`
   - `DB_FILE` = `data/database.sqlite`
4. Tekan *Deploy* ulang jika aplikasi tidak *restart* otomatis.

### Langkah 4: Hubungkan Sparkleen Laundry Utama ke API Live
Setelah deploy sukses di Railway, Anda akan mendapatkan domain publik (misal: `https://payment-api-production.up.railway.app`).
1. Buka file `.env` di aplikasi utama Sparkleen Laundry.
2. Ubah URL API (misal `PAYMENT_API_URL`) menjadi link Railway Anda.
   ```env
   PAYMENT_API_URL=https://payment-api-production.up.railway.app/api/transactions
   ```
3. Uji coba transaksi secara penuh!

> [!CAUTION]
> **Data Ephemeral (Sementara):**
> File `data/database.sqlite` tersimpan di dalam Container Docker. Artinya, **setiap kali Anda deploy ulang atau Railway melakukan restart container**, database pembayaran SQLite ini akan tereset dan kosong lagi. 
> - Jika API ini hanya dipakai untuk *MOCK/Dummy testing pembayaran* untuk demo skripsi, maka di-reset otomatis ini malah bagus karena tidak menghabiskan kuota disk.
> - Namun jika Anda ingin riwayat datanya permanen, Anda **wajib masuk ke menu Volumes di Railway** dan me-*mount* volume tersebut ke direktori `/app/data` di dalam container.
