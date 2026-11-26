CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin', 'kasir') NOT NULL DEFAULT 'kasir',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  csrf_token CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_sessions_expiry (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS master_obat (
  id_obat VARCHAR(20) NOT NULL PRIMARY KEY,
  nama_obat VARCHAR(150) NOT NULL,
  golongan ENUM('Bebas_Hijau', 'Bebas_Terbatas_Biru', 'Keras_Merah', 'Psikotropika') NOT NULL,
  satuan_besar VARCHAR(30) NOT NULL DEFAULT 'Box',
  satuan_kecil VARCHAR(30) NOT NULL DEFAULT 'Strip',
  isi_konversi INT UNSIGNED NOT NULL DEFAULT 1,
  harga_jual_ecer DECIMAL(12,2) NOT NULL,
  harga_jual_grosir DECIMAL(12,2) NOT NULL,
  stok_minimal INT UNSIGNED NOT NULL DEFAULT 10,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_master_obat_konversi CHECK (isi_konversi > 0),
  CONSTRAINT chk_master_obat_harga_ecer CHECK (harga_jual_ecer >= 0),
  CONSTRAINT chk_master_obat_harga_grosir CHECK (harga_jual_grosir >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stok_batch (
  id_batch BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id_obat VARCHAR(20) NOT NULL,
  no_batch VARCHAR(50) NOT NULL,
  expired_date DATE NOT NULL,
  harga_beli_satuan DECIMAL(12,2) NOT NULL,
  stok_tersedia INT UNSIGNED NOT NULL DEFAULT 0,
  status_stok ENUM('Aktif', 'Karantina_ED', 'Habis') NOT NULL DEFAULT 'Aktif',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stok_batch_obat_nomor (id_obat, no_batch),
  INDEX idx_stok_batch_fefo (id_obat, status_stok, expired_date),
  CONSTRAINT fk_stok_batch_obat FOREIGN KEY (id_obat) REFERENCES master_obat(id_obat),
  CONSTRAINT chk_stok_batch_hpp CHECK (harga_beli_satuan >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pelanggan (
  id_pelanggan BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nama_pelanggan VARCHAR(150) NOT NULL,
  telepon VARCHAR(40) NOT NULL DEFAULT '',
  tipe VARCHAR(40) NOT NULL DEFAULT 'Pelanggan',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS barang_masuk (
  id_masuk BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  no_faktur_pbf VARCHAR(50) NOT NULL UNIQUE,
  nama_pbf VARCHAR(100) NOT NULL,
  tgl_masuk DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metode_bayar ENUM('Lunas', 'Tempo') NOT NULL,
  tgl_jatuh_tempo DATE NULL,
  total_tagihan DECIMAL(14,2) NOT NULL,
  dibuat_oleh BIGINT UNSIGNED NOT NULL,
  INDEX idx_barang_masuk_tanggal (tgl_masuk),
  CONSTRAINT fk_barang_masuk_user FOREIGN KEY (dibuat_oleh) REFERENCES users(id),
  CONSTRAINT chk_barang_masuk_tempo CHECK (metode_bayar <> 'Tempo' OR tgl_jatuh_tempo IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detail_barang_masuk (
  id_detail BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id_masuk BIGINT UNSIGNED NOT NULL,
  id_batch BIGINT UNSIGNED NOT NULL,
  qty INT UNSIGNED NOT NULL,
  harga_beli_satuan DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_detail_masuk_header FOREIGN KEY (id_masuk) REFERENCES barang_masuk(id_masuk),
  CONSTRAINT fk_detail_masuk_batch FOREIGN KEY (id_batch) REFERENCES stok_batch(id_batch),
  CONSTRAINT chk_detail_masuk_qty CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS penjualan_ecer (
  no_struk VARCHAR(30) NOT NULL PRIMARY KEY,
  tgl_transaksi DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tipe_pelanggan ENUM('Umum', 'Pelanggan_Member') NOT NULL DEFAULT 'Umum',
  id_pelanggan BIGINT UNSIGNED NULL,
  no_resep VARCHAR(50) NULL,
  diskon_nominal DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_bayar DECIMAL(14,2) NOT NULL,
  metode_bayar ENUM('Tunai', 'Transfer_QRIS') NOT NULL,
  uang_diterima DECIMAL(14,2) NOT NULL,
  uang_kembalian DECIMAL(14,2) NOT NULL,
  dibuat_oleh BIGINT UNSIGNED NOT NULL,
  INDEX idx_penjualan_ecer_tanggal (tgl_transaksi),
  CONSTRAINT fk_penjualan_ecer_pelanggan FOREIGN KEY (id_pelanggan) REFERENCES pelanggan(id_pelanggan) ON DELETE SET NULL,
  CONSTRAINT fk_penjualan_ecer_user FOREIGN KEY (dibuat_oleh) REFERENCES users(id),
  CONSTRAINT chk_penjualan_ecer_total CHECK (total_bayar >= 0),
  CONSTRAINT chk_penjualan_ecer_tunai CHECK (metode_bayar <> 'Tunai' OR uang_diterima >= total_bayar)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detail_penjualan_ecer (
  id_detail BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  no_struk VARCHAR(30) NOT NULL,
  id_batch BIGINT UNSIGNED NOT NULL,
  qty INT UNSIGNED NOT NULL,
  harga_satuan DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_detail_ecer_header FOREIGN KEY (no_struk) REFERENCES penjualan_ecer(no_struk),
  CONSTRAINT fk_detail_ecer_batch FOREIGN KEY (id_batch) REFERENCES stok_batch(id_batch),
  CONSTRAINT chk_detail_ecer_qty CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS penjualan_grosir (
  no_faktur VARCHAR(30) NOT NULL PRIMARY KEY,
  tgl_faktur DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_pelanggan BIGINT UNSIGNED NOT NULL,
  diskon_pelanggan DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_penjualan DECIMAL(14,2) NOT NULL,
  metode_bayar ENUM('Tunai', 'Transfer', 'Tempo') NOT NULL,
  tgl_jatuh_tempo DATE NULL,
  status_pembayaran ENUM('Lunas', 'Belum_Lunas') NOT NULL DEFAULT 'Lunas',
  status_gudang ENUM('Menunggu_Penyiapan', 'Selesai_Dikirim') NOT NULL DEFAULT 'Menunggu_Penyiapan',
  dibuat_oleh BIGINT UNSIGNED NOT NULL,
  INDEX idx_penjualan_grosir_tanggal (tgl_faktur),
  CONSTRAINT fk_penjualan_grosir_pelanggan FOREIGN KEY (id_pelanggan) REFERENCES pelanggan(id_pelanggan),
  CONSTRAINT fk_penjualan_grosir_user FOREIGN KEY (dibuat_oleh) REFERENCES users(id),
  CONSTRAINT chk_penjualan_grosir_tempo CHECK (metode_bayar <> 'Tempo' OR tgl_jatuh_tempo IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detail_penjualan_grosir (
  id_detail BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  no_faktur VARCHAR(30) NOT NULL,
  id_batch BIGINT UNSIGNED NOT NULL,
  qty_satuan_besar INT UNSIGNED NOT NULL,
  qty_satuan_kecil INT UNSIGNED NOT NULL,
  harga_satuan_besar DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_detail_grosir_header FOREIGN KEY (no_faktur) REFERENCES penjualan_grosir(no_faktur),
  CONSTRAINT fk_detail_grosir_batch FOREIGN KEY (id_batch) REFERENCES stok_batch(id_batch),
  CONSTRAINT chk_detail_grosir_qty CHECK (qty_satuan_besar > 0 AND qty_satuan_kecil > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kartu_stok (
  id_log BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id_batch BIGINT UNSIGNED NOT NULL,
  waktu DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  jenis_mutasi ENUM('Masuk_PBF', 'Jual_Ecer', 'Jual_Grosir', 'Retur', 'Opname') NOT NULL,
  referensi_dokumen VARCHAR(50) NOT NULL,
  qty_masuk INT UNSIGNED NOT NULL DEFAULT 0,
  qty_keluar INT UNSIGNED NOT NULL DEFAULT 0,
  sisa_stok INT UNSIGNED NOT NULL,
  dibuat_oleh BIGINT UNSIGNED NOT NULL,
  INDEX idx_kartu_stok_batch_waktu (id_batch, waktu),
  INDEX idx_kartu_stok_waktu (waktu),
  CONSTRAINT fk_kartu_stok_batch FOREIGN KEY (id_batch) REFERENCES stok_batch(id_batch),
  CONSTRAINT fk_kartu_stok_user FOREIGN KEY (dibuat_oleh) REFERENCES users(id),
  CONSTRAINT chk_kartu_stok_mutasi CHECK (
    (qty_masuk > 0 AND qty_keluar = 0) OR (qty_keluar > 0 AND qty_masuk = 0) OR (qty_masuk = 0 AND qty_keluar = 0)
  )
) ENGINE=InnoDB;
