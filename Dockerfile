FROM node:20-alpine

# Set direktori kerja di dalam container
WORKDIR /app

# Salin package.json dan package-lock.json (jika ada) terlebih dahulu
COPY package*.json ./

# Install dependensi (hanya production)
RUN npm install --omit=dev

# Salin seluruh kode sumber ke dalam container
COPY . .

# Buat folder data untuk SQLite jika belum ada
RUN mkdir -p data

# Ekspos port yang akan digunakan. 
# Catatan: Railway secara otomatis akan me-route port yang digunakan oleh container, namun EXPOSE tetap merupakan best practice.
EXPOSE 3000

# Jalankan aplikasi
CMD ["npm", "start"]
