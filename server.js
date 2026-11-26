require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const express = require("express");
const helmet = require("helmet");
const { createPool } = require("./db/pool");
const { allocateFefo } = require("./lib/inventory");

const app = express();
const pool = createPool();
const isProduction = process.env.NODE_ENV === "production";
const sessionDays = Math.min(7, Math.max(1, Number(process.env.SESSION_DAYS || 1)));
const sessionCookie = isProduction ? "__Host-samawa_session" : "samawa_session";
const loginAttempts = new Map();
const maxLoginAttempts = 8;
const loginWindowMs = 15 * 60 * 1000;

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  },
  referrerPolicy: { policy: "no-referrer" },
}));
app.use(express.json({ limit: "256kb" }));

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function positiveInteger(value, allowZero = false) {
  return Number.isSafeInteger(Number(value)) && (allowZero ? Number(value) >= 0 : Number(value) > 0);
}

function parseMoney(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) throw apiError(400, `${field} tidak valid.`);
  return amount;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) return next(apiError(403, "Permintaan lintas situs ditolak."));
    } catch {
      return next(apiError(403, "Origin permintaan tidak valid."));
    }
  }
  next();
}

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", requireSameOrigin);

async function authenticate(req, res, next) {
  const token = req.cookies?.[sessionCookie] || parseCookies(req.headers.cookie || "")[sessionCookie];
  if (!token || token.length > 200) return next(apiError(401, "Silakan masuk terlebih dahulu."));
  try {
    const [rows] = await pool.execute(
      `SELECT s.csrf_token, u.id, u.name, u.email, u.role
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.active = TRUE LIMIT 1`,
      [hashToken(token)],
    );
    if (!rows.length) return next(apiError(401, "Sesi berakhir. Silakan masuk kembali."));
    req.user = rows[0];
    req.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name) cookies[name] = value.join("=");
  }
  return cookies;
}

function requireCsrf(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  pool.execute("SELECT csrf_token FROM auth_sessions WHERE token_hash = ?", [hashToken(req.sessionToken)])
    .then(([rows]) => {
      const suppliedToken = req.get("x-csrf-token") || "";
      if (!rows.length || suppliedToken.length !== rows[0].csrf_token.length || !crypto.timingSafeEqual(Buffer.from(rows[0].csrf_token), Buffer.from(suppliedToken))) {
        return next(apiError(403, "Token keamanan tidak valid. Muat ulang halaman dan coba lagi."));
      }
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return next(apiError(403, "Aksi ini hanya dapat dilakukan administrator."));
  next();
}

app.get("/api/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/login", async (req, res, next) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;
  if (!validString(email, 190) || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 72) return next(apiError(400, "Email dan kata sandi wajib diisi."));
  const key = `${req.ip}:${email}`;
  const attempt = loginAttempts.get(key);
  if (!attempt && loginAttempts.size >= 10000) {
    const now = Date.now();
    for (const [attemptKey, entry] of loginAttempts) {
      if (entry.until <= now || loginAttempts.size >= 9000) loginAttempts.delete(attemptKey);
      if (loginAttempts.size < 9000) break;
    }
  }
  if (attempt && attempt.until > Date.now() && attempt.count >= maxLoginAttempts) {
    res.set("Retry-After", String(Math.ceil((attempt.until - Date.now()) / 1000)));
    return next(apiError(429, "Terlalu banyak percobaan masuk. Coba kembali beberapa menit lagi."));
  }
  try {
    const [rows] = await pool.execute("SELECT id, name, email, role, password_hash FROM users WHERE email = ? AND active = TRUE LIMIT 1", [email]);
    const user = rows[0];
    const matches = await bcrypt.compare(password, user?.password_hash || "$2a$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinv");
    if (!user || !matches) {
      const previous = attempt?.until > Date.now() ? attempt : { count: 0, until: Date.now() + loginWindowMs };
      loginAttempts.set(key, { count: previous.count + 1, until: previous.until });
      return next(apiError(401, "Email atau kata sandi salah."));
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString("base64url");
    const csrfToken = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + sessionDays * 86400000);
    await pool.execute("DELETE FROM auth_sessions WHERE expires_at < NOW()");
    await pool.execute("INSERT INTO auth_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)", [hashToken(token), user.id, csrfToken, expires]);
    res.cookie(sessionCookie, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      path: "/",
      maxAge: sessionDays * 86400000,
    });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, csrfToken });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", authenticate, requireCsrf, async (req, res, next) => {
  try {
    await pool.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [hashToken(req.sessionToken)]);
    res.clearCookie(sessionCookie, { httpOnly: true, secure: isProduction, sameSite: "strict", path: "/" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", authenticate, (req, res) => {
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }, csrfToken: req.user.csrf_token });
});

app.post("/api/me/password", authenticate, requireCsrf, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || Buffer.byteLength(currentPassword, "utf8") > 72 || typeof newPassword !== "string" || newPassword.length < 14 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return next(apiError(400, "Kata sandi baru harus minimal 14 karakter dan maksimal 72 byte."));
  }
  try {
    const [[user]] = await pool.execute("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
    if (!await bcrypt.compare(currentPassword, user.password_hash)) return next(apiError(400, "Kata sandi saat ini salah."));
    if (await bcrypt.compare(newPassword, user.password_hash)) return next(apiError(400, "Kata sandi baru harus berbeda."));
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, req.user.id]);
      await connection.execute("DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?", [req.user.id, hashToken(req.sessionToken)]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use("/api", authenticate, requireCsrf);

app.get("/api/state", async (req, res, next) => {
  try {
    await pool.execute("UPDATE stok_batch SET status_stok = 'Karantina_ED' WHERE status_stok = 'Aktif' AND expired_date < CURDATE()");
    const [
      [drugs], [batches], [customers], [incoming], [salesRetail], [salesWholesale], [logs],
    ] = await Promise.all([
      pool.query("SELECT id_obat AS id, nama_obat AS name, golongan AS `group`, satuan_besar AS largeUnit, satuan_kecil AS smallUnit, isi_konversi AS conversion, harga_jual_ecer AS retail, harga_jual_grosir AS wholesale, stok_minimal AS min FROM master_obat ORDER BY nama_obat"),
      pool.query("SELECT id_batch AS id, id_obat AS drugId, no_batch AS number, expired_date AS expiry, harga_beli_satuan AS cost, stok_tersedia AS stock, status_stok AS status FROM stok_batch ORDER BY expired_date"),
      pool.query("SELECT id_pelanggan AS id, nama_pelanggan AS name, telepon AS phone, tipe AS type FROM pelanggan ORDER BY nama_pelanggan"),
      pool.query("SELECT id_masuk AS id, no_faktur_pbf AS invoice, nama_pbf AS supplier, tgl_masuk AS date, metode_bayar AS method, tgl_jatuh_tempo AS due, total_tagihan AS total, (SELECT COUNT(*) FROM detail_barang_masuk d WHERE d.id_masuk = bm.id_masuk) AS itemCount FROM barang_masuk bm ORDER BY tgl_masuk DESC"),
      pool.query("SELECT no_struk AS id, 'Jual_Ecer' AS type, tgl_transaksi AS date, IF(tipe_pelanggan = 'Umum', 'Umum', 'Member') AS customer, total_bayar AS total, metode_bayar AS method, (SELECT COUNT(DISTINCT b.id_obat) FROM detail_penjualan_ecer d JOIN stok_batch b ON b.id_batch = d.id_batch WHERE d.no_struk = pe.no_struk) AS items FROM penjualan_ecer pe"),
      pool.query("SELECT pg.no_faktur AS id, 'Jual_Grosir' AS type, pg.tgl_faktur AS date, p.nama_pelanggan AS customer, pg.total_penjualan AS total, pg.metode_bayar AS method, (SELECT COUNT(DISTINCT b.id_obat) FROM detail_penjualan_grosir d JOIN stok_batch b ON b.id_batch = d.id_batch WHERE d.no_faktur = pg.no_faktur) AS items, pg.tgl_jatuh_tempo AS due, pg.status_pembayaran AS status, pg.status_gudang AS warehouseStatus FROM penjualan_grosir pg JOIN pelanggan p ON p.id_pelanggan = pg.id_pelanggan"),
      pool.query("SELECT ks.id_log AS id, ks.id_batch AS batchId, ks.waktu AS date, ks.jenis_mutasi AS type, ks.referensi_dokumen AS reference, ks.qty_masuk AS `in`, ks.qty_keluar AS `out`, ks.sisa_stok AS balance FROM kartu_stok ks ORDER BY ks.waktu DESC"),
    ]);
    const transactions = [...salesRetail, ...salesWholesale].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ drugs, batches, customers, incoming, transactions, logs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", requireAdmin, async (req, res, next) => {
  try {
    const [users] = await pool.query("SELECT id, name, email, role, active, created_at AS createdAt FROM users ORDER BY name");
    res.json(users);
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireAdmin, async (req, res, next) => {
  const { name, email, password, role } = req.body || {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!validString(name, 120) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 190) return next(apiError(400, "Nama dan alamat email yang valid wajib diisi."));
  if (typeof password !== "string" || password.length < 14 || Buffer.byteLength(password, "utf8") > 72) return next(apiError(400, "Kata sandi harus minimal 14 karakter dan maksimal 72 byte."));
  if (!["admin", "kasir"].includes(role)) return next(apiError(400, "Peran pengguna tidak valid."));
  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", [name.trim(), normalizedEmail, hash, role]);
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return next(apiError(409, "Alamat email sudah digunakan."));
    next(error);
  }
});

app.patch("/api/users/:id/active", requireAdmin, async (req, res, next) => {
  const active = req.body?.active;
  if (typeof active !== "boolean") return next(apiError(400, "Status akun tidak valid."));
  if (!active && Number(req.params.id) === Number(req.user.id)) return next(apiError(400, "Akun yang sedang digunakan tidak dapat dinonaktifkan."));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute("SELECT id, role, active FROM users WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!users.length) throw apiError(404, "Pengguna tidak ditemukan.");
    if (!active && users[0].active && users[0].role === "admin") {
      const [activeAdmins] = await connection.query("SELECT id FROM users WHERE role = 'admin' AND active = TRUE FOR UPDATE");
      if (activeAdmins.length <= 1) throw apiError(409, "Administrator aktif terakhir tidak dapat dinonaktifkan.");
    }
    await connection.execute("UPDATE users SET active = ? WHERE id = ?", [active, req.params.id]);
    if (!active) await connection.execute("DELETE FROM auth_sessions WHERE user_id = ?", [req.params.id]);
    await connection.commit();
    res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post("/api/drugs", requireAdmin, async (req, res, next) => {
  const item = req.body;
  try {
    validateDrug(item);
    await pool.execute(
      `INSERT INTO master_obat (id_obat, nama_obat, golongan, satuan_besar, satuan_kecil, isi_konversi, harga_jual_ecer, harga_jual_grosir, stok_minimal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id.trim(), item.name.trim(), item.group, item.largeUnit.trim() || "Box", item.smallUnit.trim() || "Strip", Number(item.conversion), Number(item.retail), Number(item.wholesale), Number(item.min)],
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return next(apiError(409, "Kode obat sudah digunakan."));
    next(error);
  }
});

app.put("/api/drugs/:id", requireAdmin, async (req, res, next) => {
  const item = req.body;
  try {
    validateDrug({ ...item, id: req.params.id });
    const [result] = await pool.execute(
      `UPDATE master_obat SET nama_obat=?, golongan=?, satuan_besar=?, satuan_kecil=?, isi_konversi=?, harga_jual_ecer=?, harga_jual_grosir=?, stok_minimal=?
       WHERE id_obat=?`,
      [item.name.trim(), item.group, item.largeUnit.trim() || "Box", item.smallUnit.trim() || "Strip", Number(item.conversion), Number(item.retail), Number(item.wholesale), Number(item.min), req.params.id],
    );
    if (!result.affectedRows) return next(apiError(404, "Obat tidak ditemukan."));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function validateDrug(item) {
  const groups = ["Bebas_Hijau", "Bebas_Terbatas_Biru", "Keras_Merah", "Psikotropika"];
  if (!item || !validString(item.id, 20) || !validString(item.name, 150) || !groups.includes(item.group)) throw apiError(400, "Data obat tidak lengkap atau golongan tidak valid.");
  if (!positiveInteger(item.conversion) || Number(item.conversion) > 4294967295 || !positiveInteger(item.min, true) || Number(item.min) > 4294967295) throw apiError(400, "Konversi dan stok minimal tidak valid.");
  parseMoney(item.retail, "Harga ecer");
  parseMoney(item.wholesale, "Harga grosir");
  if (typeof item.largeUnit !== "string" || item.largeUnit.length > 30 || typeof item.smallUnit !== "string" || item.smallUnit.length > 30) throw apiError(400, "Satuan obat tidak valid.");
}

app.delete("/api/drugs/:id", requireAdmin, async (req, res, next) => {
  try {
    const [batches] = await pool.execute("SELECT id_batch FROM stok_batch WHERE id_obat = ? LIMIT 1", [req.params.id]);
    if (batches.length) return next(apiError(409, "Obat memiliki riwayat batch/stok dan tidak dapat dihapus."));
    const [result] = await pool.execute("DELETE FROM master_obat WHERE id_obat = ?", [req.params.id]);
    if (!result.affectedRows) return next(apiError(404, "Obat tidak ditemukan."));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/batches", requireAdmin, async (req, res, next) => {
  const { drugId, number, expiry, cost, stock } = req.body || {};
  if (!validString(drugId, 20) || !validString(number, 50) || !isValidDate(expiry) || expiry < new Date().toISOString().slice(0, 10) || !positiveInteger(stock) || !Number.isSafeInteger(Number(stock)) || Number(stock) > 4294967295) return next(apiError(400, "Data batch tidak valid atau tanggal ED telah lewat."));
  try {
    const costValue = parseMoney(cost, "HPP");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [batchResult] = await connection.execute(
        "INSERT INTO stok_batch (id_obat, no_batch, expired_date, harga_beli_satuan, stok_tersedia, status_stok) VALUES (?, ?, ?, ?, ?, 'Aktif')",
        [drugId, number.trim(), expiry, costValue, Number(stock)],
      );
      await connection.execute("INSERT INTO kartu_stok (id_batch, jenis_mutasi, referensi_dokumen, qty_masuk, sisa_stok, dibuat_oleh) VALUES (?, 'Opname', 'STOK-AWAL', ?, ?, ?)", [batchResult.insertId, Number(stock), Number(stock), req.user.id]);
      await connection.commit();
      res.status(201).json({ ok: true });
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") return next(apiError(409, "Nomor batch sudah digunakan untuk obat ini."));
      if (error.code === "ER_NO_REFERENCED_ROW_2") return next(apiError(404, "Obat tidak ditemukan."));
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

app.patch("/api/batches/:id/status", requireAdmin, async (req, res, next) => {
  const { status } = req.body || {};
  if (!["Aktif", "Karantina_ED"].includes(status)) return next(apiError(400, "Status batch tidak valid."));
  try {
    const [rows] = await pool.execute("SELECT expired_date, stok_tersedia FROM stok_batch WHERE id_batch = ?", [req.params.id]);
    if (!rows.length) return next(apiError(404, "Batch tidak ditemukan."));
    if (!rows[0].stok_tersedia) return next(apiError(409, "Batch tanpa stok tidak dapat diubah statusnya."));
    if (status === "Aktif" && rows[0].expired_date < new Date().toISOString().slice(0, 10)) return next(apiError(409, "Batch kedaluwarsa tidak dapat diaktifkan."));
    await pool.execute("UPDATE stok_batch SET status_stok = ? WHERE id_batch = ?", [status, req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/incoming", async (req, res, next) => {
  const { invoice, supplier, method, due, items } = req.body || {};
  if (!validString(invoice, 50) || !validString(supplier, 100) || !["Lunas", "Tempo"].includes(method) || !Array.isArray(items) || items.length < 1 || items.length > 100) return next(apiError(400, "Informasi barang masuk tidak lengkap."));
  if (method === "Tempo" && !isValidDate(due)) return next(apiError(400, "Tanggal jatuh tempo wajib diisi untuk pembayaran tempo."));
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let total = 0;
      const incomingItems = [];
      for (const item of items) {
        if (!validString(item.drugId, 20) || !validString(item.number, 50) || !isValidDate(item.expiry) || item.expiry < new Date().toISOString().slice(0, 10) || !positiveInteger(item.qty) || !Number.isSafeInteger(Number(item.qty)) || Number(item.qty) > 4294967295) throw apiError(400, "Detail batch barang masuk tidak valid.");
        const cost = parseMoney(item.cost, "Harga beli");
        const [drugRows] = await connection.execute("SELECT id_obat FROM master_obat WHERE id_obat = ? FOR UPDATE", [item.drugId]);
        if (!drugRows.length) throw apiError(404, "Obat tidak ditemukan.");
        const [existingRows] = await connection.execute("SELECT id_batch, expired_date, status_stok, stok_tersedia FROM stok_batch WHERE id_obat = ? AND no_batch = ? FOR UPDATE", [item.drugId, item.number.trim()]);
        let batchId;
        let balance;
        if (existingRows.length) {
          const batch = existingRows[0];
          if (batch.expired_date !== item.expiry) throw apiError(409, "Tanggal ED berbeda dengan data batch yang sudah tercatat.");
          batchId = batch.id_batch;
          balance = Number(batch.stok_tersedia) + Number(item.qty);
          await connection.execute("UPDATE stok_batch SET harga_beli_satuan=?, stok_tersedia=?, status_stok='Aktif' WHERE id_batch=?", [cost, balance, batchId]);
        } else {
          const [result] = await connection.execute("INSERT INTO stok_batch (id_obat, no_batch, expired_date, harga_beli_satuan, stok_tersedia, status_stok) VALUES (?, ?, ?, ?, ?, 'Aktif')", [item.drugId, item.number.trim(), item.expiry, cost, Number(item.qty)]);
          batchId = result.insertId;
          balance = Number(item.qty);
        }
        total += cost * Number(item.qty);
        if (total > 999999999999.99) throw apiError(400, "Total barang masuk melebihi batas maksimum.");
        incomingItems.push({ batchId, qty: Number(item.qty), cost, balance });
      }
      const [header] = await connection.execute(
        "INSERT INTO barang_masuk (no_faktur_pbf, nama_pbf, metode_bayar, tgl_jatuh_tempo, total_tagihan, dibuat_oleh) VALUES (?, ?, ?, ?, ?, ?)",
        [invoice.trim(), supplier.trim(), method, method === "Tempo" ? due : null, total, req.user.id],
      );
      for (const item of incomingItems) {
        await connection.execute("INSERT INTO detail_barang_masuk (id_masuk, id_batch, qty, harga_beli_satuan, subtotal) VALUES (?, ?, ?, ?, ?)", [header.insertId, item.batchId, item.qty, item.cost, item.qty * item.cost]);
        await connection.execute("INSERT INTO kartu_stok (id_batch, jenis_mutasi, referensi_dokumen, qty_masuk, sisa_stok, dibuat_oleh) VALUES (?, 'Masuk_PBF', ?, ?, ?, ?)", [item.batchId, invoice.trim(), item.qty, item.balance, req.user.id]);
      }
      await connection.commit();
      res.status(201).json({ ok: true, total });
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") return next(apiError(409, "Nomor faktur PBF sudah pernah dicatat."));
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

app.post("/api/sales", async (req, res, next) => {
  const { type, items, method, discount = 0 } = req.body || {};
  const wholesale = type === "Jual_Grosir";
  if ((!wholesale && type !== "Jual_Ecer") || !Array.isArray(items) || items.length < 1 || items.length > 100) return next(apiError(400, "Data transaksi tidak valid."));
  const allowedMethods = wholesale ? ["Tunai", "Transfer", "Tempo"] : ["Tunai", "Transfer_QRIS"];
  if (!allowedMethods.includes(method)) return next(apiError(400, "Metode pembayaran tidak valid."));
  if (items.some((item) => !validString(item.drugId, 20) || !positiveInteger(item.qty) || !Number.isSafeInteger(Number(item.qty)) || Number(item.qty) > 2147483647)) return next(apiError(400, "Jumlah item tidak valid."));
  const quantities = new Map();
  for (const item of items) quantities.set(item.drugId, (quantities.get(item.drugId) || 0) + Number(item.qty));
  if (quantities.size !== items.length) return next(apiError(400, "Jangan mengirim obat yang sama lebih dari satu kali."));

  const customerType = req.body.customerType === "Pelanggan_Member" ? "Pelanggan_Member" : "Umum";
  const prescription = validString(req.body.prescription, 50) ? req.body.prescription.trim() : null;
  const due = req.body.due;
  const customerIdProvided = req.body.customerId;
  const newCustomerName = req.body.customerName;
  const cashReceived = Number(req.body.cashReceived);

  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const drugIds = [...quantities.keys()].sort();
      const [drugRows] = await connection.query(
        `SELECT id_obat, nama_obat, golongan, isi_konversi, harga_jual_ecer, harga_jual_grosir
         FROM master_obat WHERE id_obat IN (?) ORDER BY id_obat FOR UPDATE`,
        [drugIds],
      );
      if (drugRows.length !== drugIds.length) throw apiError(404, "Satu atau lebih obat tidak ditemukan.");
      if (!wholesale && drugRows.some((drug) => ["Keras_Merah", "Psikotropika"].includes(drug.golongan)) && !prescription) throw apiError(400, "Nomor resep wajib untuk obat keras atau psikotropika.");

      let customerId = null;
      let customerName = customerType === "Pelanggan_Member" ? "Member" : "Umum";
      if (wholesale) {
        if (customerIdProvided) {
          const [customers] = await connection.execute("SELECT id_pelanggan, nama_pelanggan FROM pelanggan WHERE id_pelanggan = ? FOR UPDATE", [customerIdProvided]);
          if (!customers.length) throw apiError(404, "Pelanggan tidak ditemukan.");
          customerId = customers[0].id_pelanggan;
          customerName = customers[0].nama_pelanggan;
        } else if (validString(newCustomerName, 150)) {
          const [customer] = await connection.execute("INSERT INTO pelanggan (nama_pelanggan) VALUES (?)", [newCustomerName.trim()]);
          customerId = customer.insertId;
          customerName = newCustomerName.trim();
        } else {
          throw apiError(400, "Pelanggan wajib dipilih untuk penjualan grosir.");
        }
        if (method === "Tempo" && !isValidDate(due)) throw apiError(400, "Tanggal jatuh tempo wajib diisi untuk pembayaran tempo.");
      }

      const drugMap = new Map(drugRows.map((drug) => [drug.id_obat, drug]));
      let subtotal = 0;
      const lines = [];
      for (const [drugId, quantity] of quantities.entries()) {
        const drug = drugMap.get(drugId);
        const unitPrice = Number(wholesale ? drug.harga_jual_grosir : drug.harga_jual_ecer);
        const conversion = Number(drug.isi_konversi);
        const retailUnits = wholesale ? quantity * conversion : quantity;
        if (!Number.isSafeInteger(retailUnits) || retailUnits > 2147483647) throw apiError(400, "Jumlah unit melebihi batas.");
        const [batches] = await connection.execute(
          `SELECT id_batch, no_batch, expired_date, stok_tersedia
           FROM stok_batch
           WHERE id_obat = ? AND status_stok = 'Aktif' AND stok_tersedia > 0 AND expired_date >= CURDATE()
           ORDER BY expired_date ASC, id_batch ASC FOR UPDATE`,
          [drugId],
        );
        const allocations = allocateFefo(batches, quantity, conversion, wholesale);
        if (!allocations) throw apiError(409, `Stok ${drug.nama_obat} tidak mencukupi dalam batch aktif yang belum kedaluwarsa.`);
        subtotal += unitPrice * quantity;
        for (const allocation of allocations) {
          lines.push({
            drugId,
            batchId: allocation.batchId,
            qty: allocation.retailUnits,
            unitPrice,
            subtotal: unitPrice * (wholesale ? allocation.largeUnits : allocation.retailUnits),
            largeQty: allocation.largeUnits,
          });
        }
      }
      const discountValue = parseMoney(discount, "Diskon");
      if (discountValue > subtotal) throw apiError(400, "Diskon tidak boleh melebihi subtotal.");
      const total = subtotal - discountValue;
      if (total > 999999999999.99) throw apiError(400, "Total transaksi melebihi batas maksimum.");
      if (!wholesale && method === "Tunai" && (!Number.isFinite(cashReceived) || cashReceived < total)) throw apiError(400, "Uang diterima belum mencukupi.");
      if (!wholesale && method !== "Tunai" && (!Number.isFinite(cashReceived) || cashReceived < 0)) throw apiError(400, "Nilai pembayaran tidak valid.");
      const docPrefix = wholesale ? "FKT" : "STR";
      const docNumber = `${docPrefix}-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      if (wholesale) {
        await connection.execute(
          `INSERT INTO penjualan_grosir (no_faktur, id_pelanggan, diskon_pelanggan, total_penjualan, metode_bayar, tgl_jatuh_tempo, status_pembayaran, dibuat_oleh)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [docNumber, customerId, discountValue, total, method, method === "Tempo" ? due : null, method === "Tempo" ? "Belum_Lunas" : "Lunas", req.user.id],
        );
      } else {
        await connection.execute(
          `INSERT INTO penjualan_ecer (no_struk, tipe_pelanggan, no_resep, diskon_nominal, total_bayar, metode_bayar, uang_diterima, uang_kembalian, dibuat_oleh)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [docNumber, customerType, prescription, discountValue, total, method === "Transfer_QRIS" ? "Transfer_QRIS" : "Tunai", cashReceived, method === "Tunai" ? cashReceived - total : 0, req.user.id],
        );
      }
      for (const line of lines) {
        const [batchRows] = await connection.execute("SELECT stok_tersedia FROM stok_batch WHERE id_batch = ? FOR UPDATE", [line.batchId]);
        const balance = Number(batchRows[0].stok_tersedia) - line.qty;
        await connection.execute("UPDATE stok_batch SET stok_tersedia = ?, status_stok = ? WHERE id_batch = ?", [balance, balance ? "Aktif" : "Habis", line.batchId]);
        if (wholesale) {
          await connection.execute(
            "INSERT INTO detail_penjualan_grosir (no_faktur, id_batch, qty_satuan_besar, qty_satuan_kecil, harga_satuan_besar, subtotal) VALUES (?, ?, ?, ?, ?, ?)",
            [docNumber, line.batchId, line.largeQty, line.qty, line.unitPrice, line.subtotal],
          );
        } else {
          await connection.execute(
            "INSERT INTO detail_penjualan_ecer (no_struk, id_batch, qty, harga_satuan, subtotal) VALUES (?, ?, ?, ?, ?)",
            [docNumber, line.batchId, line.qty, line.unitPrice, line.subtotal],
          );
        }
        await connection.execute(
          "INSERT INTO kartu_stok (id_batch, jenis_mutasi, referensi_dokumen, qty_keluar, sisa_stok, dibuat_oleh) VALUES (?, ?, ?, ?, ?, ?)",
          [line.batchId, wholesale ? "Jual_Grosir" : "Jual_Ecer", docNumber, line.qty, balance, req.user.id],
        );
      }
      await connection.commit();
      res.status(201).json({ id: docNumber, customer: customerName, total, change: !wholesale && method === "Tunai" ? cashReceived - total : 0 });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

app.patch("/api/sales/:id/warehouse", requireAdmin, async (req, res, next) => {
  if (req.body?.status !== "Selesai_Dikirim") return next(apiError(400, "Status pengiriman tidak valid."));
  try {
    const [result] = await pool.execute("UPDATE penjualan_grosir SET status_gudang = 'Selesai_Dikirim' WHERE no_faktur = ?", [req.params.id]);
    if (!result.affectedRows) {
      const [rows] = await pool.execute("SELECT status_gudang FROM penjualan_grosir WHERE no_faktur = ?", [req.params.id]);
      if (!rows.length) return next(apiError(404, "Faktur grosir tidak ditemukan."));
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "styles.css")));
app.get("/app.js", (req, res) => res.sendFile(path.join(__dirname, "app.js")));
app.use("/api", (req, res, next) => next(apiError(404, "Endpoint tidak ditemukan.")));
app.use((req, res, next) => next(apiError(404, "Halaman tidak ditemukan.")));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Data sudah terdaftar." });
  if (error.code === "ECONNREFUSED" || error.code === "PROTOCOL_CONNECTION_LOST") {
    console.error("Koneksi MySQL gagal:", error.message);
    return res.status(503).json({ error: "Database tidak tersedia. Periksa layanan MySQL." });
  }
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error("Kesalahan server:", error);
  res.status(500).json({ error: "Terjadi kesalahan server. Silakan coba kembali." });
});

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`Samawa Farma berjalan pada port ${port} (${isProduction ? "production" : "development"}).`);
});

async function shutdown(signal) {
  console.log(`${signal} diterima, menutup server.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
