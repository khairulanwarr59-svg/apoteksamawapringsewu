require("dotenv").config();

const bcrypt = require("bcryptjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPool } = require("../db/pool");

async function main() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_NAME) {
    throw new Error("Isi ADMIN_NAME, ADMIN_EMAIL, dan ADMIN_PASSWORD di .env sebelum inisialisasi.");
  }
  if (process.env.ADMIN_PASSWORD.length < 14 || Buffer.byteLength(process.env.ADMIN_PASSWORD, "utf8") > 72 || process.env.ADMIN_PASSWORD === "change-this-before-initialization") {
    throw new Error("ADMIN_PASSWORD harus unik, minimal 14 karakter, dan maksimal 72 byte.");
  }

  const pool = createPool();
  try {
    const schema = await fs.readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
    const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await pool.query(statement);

    const [existing] = await pool.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [process.env.ADMIN_EMAIL.toLowerCase()]);
    if (existing.length) {
      console.log("Skema database siap. Akun administrator yang sudah ada tidak diubah.");
    } else {
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await pool.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
        [process.env.ADMIN_NAME.trim(), process.env.ADMIN_EMAIL.toLowerCase(), passwordHash],
      );
      console.log(`Skema siap dan akun administrator dibuat: ${process.env.ADMIN_EMAIL}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Inisialisasi database gagal: ${error.message}`);
  process.exitCode = 1;
});
