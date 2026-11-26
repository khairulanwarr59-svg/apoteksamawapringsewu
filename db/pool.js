const mysql = require("mysql2/promise");

function createPool() {
  const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Konfigurasi database belum lengkap: ${missing.join(", ")}.`);
  }

  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "+07:00",
    dateStrings: true,
    decimalNumbers: true,
    enableKeepAlive: true,
  });
}

module.exports = { createPool };
