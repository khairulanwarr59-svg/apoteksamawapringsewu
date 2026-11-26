# Samawa Farma

Sistem operasional apotek berbahasa Indonesia dengan backend Node.js/Express dan MySQL 8. Data transaksi disimpan terpusat di MySQL, bukan di browser.

## Menyiapkan di komputer lokal

Persyaratan: Node.js 20+, npm, dan Docker dengan Docker Compose.

1. Salin `.env.example` menjadi `.env`, lalu isi kata sandi database dan administrator yang unik. Kata sandi administrator minimal 14 karakter dan maksimal 72 byte. Jangan bagikan atau commit `.env`.
2. Jalankan MySQL: `docker compose up -d --wait mysql`
3. Pasang dependensi: `npm install`
4. Buat tabel dan akun administrator awal: `npm run db:init`
5. Jalankan aplikasi: `npm start`
6. Buka `http://localhost:3000` dan masuk dengan `ADMIN_EMAIL` / `ADMIN_PASSWORD` dari `.env`.

Database disimpan pada Docker volume `samawa_mysql_data`. Akun awal tidak dibuat ulang atau kata sandinya ditimpa jika alamat email itu sudah ada. Setelah masuk, buat akun staf melalui menu **Akun Pengguna**.

Untuk memakai MySQL yang sudah ada, siapkan database dan user MySQL terlebih dahulu, atur `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, dan `DB_PASSWORD` di `.env`, lalu jalankan `npm run db:init`. User database perlu hak `CREATE`, `ALTER`, `INDEX`, `SELECT`, `INSERT`, `UPDATE`, dan `DELETE` pada database aplikasi.

## Fungsi

- Dashboard persediaan, penjualan, dan peringatan tanggal kedaluwarsa.
- Master obat dan konversi satuan, batch dan karantina ED, penerimaan PBF.
- POS ecer dengan resep wajib untuk obat keras/psikotropika.
- Penjualan grosir dengan konversi kemasan, pelanggan, diskon, dan tempo.
- Pengurangan stok FEFO di backend dalam transaksi MySQL terkunci/atomik.
- Kartu stok audit dan ekspor CSV.
- Login, sesi server yang disimpan di MySQL, perlindungan CSRF, peran administrator/kasir, serta pengelolaan akun.

## Operasional dan keamanan

Database MySQL pada konfigurasi Compose hanya di-bind ke `127.0.0.1`. Server web juga secara default hanya mendengarkan `127.0.0.1`. Untuk akses staf melalui jaringan, pasang reverse proxy HTTPS, batasi jaringan/firewall, atur `NODE_ENV=production`, dan tinjau konfigurasi host/domain sebelum membuka akses.

Sebelum operasional nyata, lakukan backup MySQL terjadwal dan uji pemulihannya, amankan host dan file `.env`, siapkan pemantauan, dan pastikan alur kerja sesuai aturan apotek setempat. Sistem ini bukan rekam medis; hindari menyimpan data pasien yang tidak diperlukan. Data awal kosong—tambahkan master obat serta penerimaan stok yang benar sebelum mulai menjual.

Contoh backup manual (simpan backup di lokasi terenkripsi/terbatas, bukan Git):

```sh
mkdir -p backups
docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > backups/samawa-$(date +%F).sql
```

Pemulihan dari file backup (akan mengganti data database aktif; lakukan hanya setelah memastikan file dan targetnya):

```sh
docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < backups/samawa-YYYY-MM-DD.sql
```

Tes lokal: `npm test`. Pemeriksaan dependensi: `npm audit`.
