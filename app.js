let state = { drugs: [], batches: [], customers: [], transactions: [], logs: [], incoming: [] };
let activePage = "dashboard";
let currentFilter = "";
let activeCart = [];
let csrfToken = "";
let currentUser = null;

const pageNames = {
  dashboard: "Dashboard", obat: "Master Obat", stok: "Stok & Batch",
  masuk: "Barang Masuk", ecer: "Kasir Ecer", grosir: "Penjualan Grosir", kartu: "Kartu Stok", users: "Akun Pengguna",
};
const pageContainer = document.getElementById("page-container");
const modalLayer = document.getElementById("modal-layer");

async function apiRequest(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && currentUser) showLogin();
    throw new Error(payload.error || `Permintaan gagal (${response.status}).`);
  }
  return payload;
}

async function refreshState() {
  state = await apiRequest("/state");
  updateHeader();
  renderPage();
}

function showLogin() {
  currentUser = null;
  csrfToken = "";
  document.getElementById("app-shell").hidden = true;
  document.getElementById("auth-screen").hidden = false;
  document.getElementById("login-password").value = "";
}

function showApplication(user, token) {
  currentUser = user;
  csrfToken = token;
  document.getElementById("auth-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  document.getElementById("profile-name").textContent = user.name;
  document.getElementById("profile-role").textContent = user.role === "admin" ? "Administrator" : "Kasir";
  document.getElementById("profile-initials").textContent = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  document.getElementById("users-nav").hidden = user.role !== "admin";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function rupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function dateLabel(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : value.includes(" ") ? value.replace(" ", "T") : `${value}T00:00:00`);
  return new Intl.DateTimeFormat("id-ID", withTime ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function dateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function drugById(id) { return state.drugs.find((drug) => drug.id === id); }
function batchStock(drugId) { return state.batches.filter((batch) => batch.drugId === drugId && batch.status === "Aktif").reduce((sum, batch) => sum + Number(batch.stock), 0); }
function drugStock(drugId) { return batchStock(drugId); }
function groupLabel(group) { return ({ Bebas_Hijau: "Bebas", Bebas_Terbatas_Biru: "Bebas Terbatas", Keras_Merah: "Obat Keras", Psikotropika: "Psikotropika" })[group] || group; }
function groupClass(group) { return group === "Keras_Merah" || group === "Psikotropika" ? "red" : group === "Bebas_Terbatas_Biru" ? "blue" : "green"; }
function statusPill(status) { return `<span class="pill ${status === "Aktif" ? "green" : status === "Karantina_ED" ? "red" : "gray"}">${esc(status.replaceAll("_", " "))}</span>`; }
function nextId(prefix, list) {
  const number = list.reduce((max, row) => Math.max(max, Number(String(row.id).match(/\d+$/)?.[0] || 0)), 0) + 1;
  return `${prefix}${String(number).padStart(3, "0")}`;
}

function toast(message, error = false) {
  const item = document.createElement("div");
  item.className = `toast${error ? " error" : ""}`;
  item.textContent = message;
  document.getElementById("toast-region").append(item);
  window.setTimeout(() => item.remove(), 3400);
}

function updateHeader() {
  document.getElementById("breadcrumb-current").textContent = pageNames[activePage];
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date());
  document.getElementById("expiry-count").textContent = expiringBatches().length;
}

function expiringBatches() {
  const now = new Date();
  const limit = new Date(now);
  limit.setDate(now.getDate() + 90);
  return state.batches.filter((batch) => batch.status === "Aktif" && batch.stock > 0 && new Date(`${batch.expiry}T00:00:00`) <= limit);
}

function setPage(page) {
  if ((activePage === "ecer" && page !== "ecer") || (activePage === "grosir" && page !== "grosir")) activeCart = [];
  activePage = page;
  currentFilter = "";
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  document.getElementById("sidebar").classList.remove("open");
  renderPage();
}

function renderPage() {
  updateHeader();
  const renderers = { dashboard: renderDashboard, obat: renderDrugs, stok: renderBatches, masuk: renderIncoming, ecer: () => renderSale(false), grosir: () => renderSale(true), kartu: renderStockCard, users: renderUsers };
  Promise.resolve((renderers[activePage] || renderDashboard)()).catch((error) => toast(error.message, true));
}

function pageHeading(title, description, button = "") {
  return `<div class="page-heading"><div><div class="eyebrow">SAMAWA FARMA / ${esc(pageNames[activePage])}</div><h1>${title}</h1><p>${description}</p></div>${button}</div>`;
}

function stockPill(stock, min) {
  if (stock <= min) return `<span class="pill red">Stok menipis</span>`;
  if (stock <= min * 1.5) return `<span class="pill orange">Perlu perhatian</span>`;
  return `<span class="pill green">Stok aman</span>`;
}

function salesChart(transactions) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 13 + index);
    return date;
  });
  const totals = days.map((day) => transactions.reduce((sum, transaction) => {
    const date = new Date(transaction.date.includes(" ") ? transaction.date.replace(" ", "T") : transaction.date);
    date.setHours(0, 0, 0, 0);
    return date.getTime() === day.getTime() ? sum + Number(transaction.total) : sum;
  }, 0));
  const recent = totals.slice(7);
  const previous = totals.slice(0, 7);
  const maximum = Math.max(100, ...totals) * 1.15;
  const x = (index) => 40 + index * 101;
  const y = (value) => 160 - (value / maximum) * 135;
  const pointList = (values) => values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const currentPoints = recent.map((value, index) => `${x(index)},${y(value)}`);
  const previousPoints = previous.map((value, index) => `${x(index)},${y(value)}`);
  const area = `${currentPoints[0]} ${currentPoints.slice(1).join(" ")} ${x(6)},160 ${x(0)},160`;
  const axis = Array.from({ length: 4 }, (_, index) => {
    const value = maximum * (3 - index) / 3;
    const label = value >= 1000000 ? `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)} jt` : `${Math.round(value / 1000)} rb`;
    const axisY = 15 + index * 45;
    return `<line class="chart-grid" x1="39" y1="${axisY}" x2="690" y2="${axisY}"/><text class="chart-label" x="0" y="${axisY + 3}">${label}</text>`;
  }).join("");
  const labels = days.slice(7).map((day, index) => `<text class="chart-label" x="${x(index) - 7}" y="184">${new Intl.DateTimeFormat("id-ID", { weekday: "short" }).format(day)}</text>`).join("");
  return `<svg class="chart" viewBox="0 0 700 190" preserveAspectRatio="none" role="img" aria-label="Grafik penjualan dua minggu terakhir">
    <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#57ae82" stop-opacity=".2"/><stop offset="100%" stop-color="#57ae82" stop-opacity="0"/></linearGradient></defs>
    ${axis}<polygon class="chart-fill" points="${area}"/><polyline class="chart-line-secondary" points="${pointList(previous)}"/><polyline class="chart-line" points="${currentPoints.join(" ")}"/>${labels}
  </svg>`;
}

function renderDashboard() {
  const stockCount = state.drugs.reduce((sum, drug) => sum + drugStock(drug.id), 0);
  const lowStock = state.drugs.filter((drug) => drugStock(drug.id) <= drug.min);
  const todaySales = state.transactions.filter((transaction) => new Date(transaction.date).toDateString() === new Date().toDateString());
  const salesTotal = todaySales.reduce((sum, transaction) => sum + transaction.total, 0);
  const expiry = expiringBatches().slice(0, 4);
  const latest = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const chart = salesChart(state.transactions);
  pageContainer.innerHTML = `${pageHeading(`Selamat beraktivitas, ${esc(currentUser.name)} 👋`, "Berikut ringkasan operasional apotek Anda hari ini.")}
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-top"><span>Total Penjualan Hari Ini</span><span class="stat-icon">↗</span></div><div class="stat-value">${rupiah(salesTotal)}</div><div class="stat-foot"><span class="positive">↗ ${todaySales.length} transaksi</span> hari ini</div></div>
      <div class="stat-card"><div class="stat-top"><span>Total Jenis Obat</span><span class="stat-icon blue">▤</span></div><div class="stat-value">${state.drugs.length} <small style="font-size:11px;font-weight:500;color:#89958d">jenis</small></div><div class="stat-foot">Tersedia di master obat</div></div>
      <div class="stat-card"><div class="stat-top"><span>Total Stok Tersedia</span><span class="stat-icon orange">▦</span></div><div class="stat-value">${stockCount.toLocaleString("id-ID")} <small style="font-size:11px;font-weight:500;color:#89958d">unit</small></div><div class="stat-foot">Dalam satuan terkecil</div></div>
      <div class="stat-card"><div class="stat-top"><span>Perlu Restock</span><span class="stat-icon pink">!</span></div><div class="stat-value">${lowStock.length} <small style="font-size:11px;font-weight:500;color:#89958d">obat</small></div><div class="stat-foot">${lowStock.length ? "Periksa persediaan minimum" : "Semua stok aman"}</div></div>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div><h2>Ringkasan Penjualan</h2><p>Performa penjualan selama 7 hari terakhir</p></div><select class="select-control" aria-label="Periode grafik"><option>7 hari terakhir</option></select></div><div class="chart-area"><div class="chart-legend"><span><i class="legend-dot"></i>Penjualan</span><span><i class="legend-dot light"></i>Periode lalu</span></div>${chart}</div></section>
      <section class="panel"><div class="panel-header"><div><h2>Aksi Cepat</h2><p>Akses fitur yang sering digunakan</p></div></div><div class="quick-actions">
        <button class="quick-action" data-go="ecer"><span>▣</span>Transaksi Baru</button><button class="quick-action" data-go="masuk"><span>↙</span>Barang Masuk</button><button class="quick-action" data-go="obat"><span>＋</span>Tambah Obat</button><button class="quick-action" data-go="kartu"><span>≋</span>Kartu Stok</button>
      </div><div class="panel-header" style="min-height:49px"><div><h2>Perhatian ED</h2><p>Batch kedaluwarsa dalam 90 hari</p></div><button class="text-button" data-go="stok">Lihat semua →</button></div><div class="alert-list">${expiry.length ? expiry.map((batch) => `<div class="alert-item"><span class="alert-marker red">⌛</span><div class="alert-copy"><strong>${esc(drugById(batch.drugId)?.name || batch.drugId)}</strong><small>Batch ${esc(batch.number)} · ${batch.stock} unit</small></div><span class="alert-date">${dateLabel(batch.expiry)}</span></div>`).join("") : `<div class="empty-state">Tidak ada batch yang mendekati kedaluwarsa.</div>`}</div></section>
    </div>
    <section class="panel table-panel"><div class="panel-header"><div><h2>Transaksi Terbaru</h2><p>Aktivitas penjualan apotek terkini</p></div><button class="text-button" data-go="kartu">Lihat laporan →</button></div><div class="table-wrap"><table><thead><tr><th>NO. STRUK</th><th>WAKTU</th><th>PELANGGAN</th><th>ITEM</th><th>METODE</th><th>TOTAL</th><th>STATUS</th></tr></thead><tbody>${latest.length ? latest.map((tx) => `<tr><td><strong>${esc(tx.id)}</strong></td><td>${dateLabel(tx.date, true)}</td><td>${esc(tx.customer)}</td><td>${tx.items} item</td><td>${esc(tx.method.replaceAll("_", " "))}</td><td><strong>${rupiah(tx.total)}</strong></td><td><span class="pill green">Selesai</span></td></tr>`).join("") : `<tr><td colspan="7" class="empty-state">Belum ada transaksi.</td></tr>`}</tbody></table></div></section>`;
  bindNavigationButtons();
}

function renderDrugs() {
  const filtered = state.drugs.filter((drug) => `${drug.id} ${drug.name} ${groupLabel(drug.group)}`.toLowerCase().includes(currentFilter.toLowerCase()));
  pageContainer.innerHTML = `${pageHeading("Master Obat", "Kelola data obat, golongan, satuan, dan harga jual.", currentUser.role === "admin" ? `<button class="button" data-action="add-drug"><span class="plus">＋</span>Tambah Obat</button>` : "")}
    <section class="panel table-panel"><div class="table-toolbar"><div class="table-toolbar-left"><label class="search-box"><span>⌕</span><input id="table-search" placeholder="Cari nama atau kode obat..." value="${esc(currentFilter)}" /></label><select class="select-control" id="group-filter"><option value="">Semua golongan</option><option value="Bebas_Hijau">Bebas</option><option value="Bebas_Terbatas_Biru">Bebas Terbatas</option><option value="Keras_Merah">Obat Keras</option><option value="Psikotropika">Psikotropika</option></select></div><span style="color:#9aa49d;font-size:10px">Menampilkan ${filtered.length} obat</span></div>
    <div class="table-wrap"><table><thead><tr><th>OBAT</th><th>GOLONGAN</th><th>KONVERSI</th><th>HARGA ECER</th><th>HARGA GROSIR</th><th>STOK</th><th>STATUS STOK</th><th></th></tr></thead><tbody>${filtered.length ? filtered.map((drug, index) => {
    const stock = drugStock(drug.id);
    return `<tr><td><div class="medicine-cell"><span class="medicine-thumb ${["", "blue", "orange", "pink"][index % 4]}">✚</span><span><strong>${esc(drug.name)}</strong><small>${esc(drug.id)}</small></span></div></td><td><span class="pill ${groupClass(drug.group)}">${groupLabel(drug.group)}</span></td><td>1 ${esc(drug.largeUnit)} = ${drug.conversion} ${esc(drug.smallUnit)}</td><td>${rupiah(drug.retail)}</td><td>${rupiah(drug.wholesale)}</td><td><strong>${stock}</strong> ${esc(drug.smallUnit)}</td><td>${stockPill(stock, drug.min)}</td><td>${currentUser.role === "admin" ? `<button class="row-actions" data-action="drug-menu" data-id="${esc(drug.id)}" aria-label="Aksi obat">···</button>` : ""}</td></tr>`;
  }).join("") : `<tr><td colspan="8" class="empty-state">Obat tidak ditemukan.</td></tr>`}</tbody></table></div><div class="table-foot"><span>Data disimpan terpusat di database apotek</span><span>${filtered.length} jenis obat</span></div></section>`;
  const search = document.getElementById("table-search");
  search.addEventListener("input", (event) => { currentFilter = event.target.value; renderDrugs(); document.getElementById("table-search").focus(); document.getElementById("table-search").setSelectionRange(currentFilter.length, currentFilter.length); });
  document.getElementById("group-filter").addEventListener("change", (event) => {
    const group = event.target.value;
    if (group) {
      currentFilter = "";
      const rows = state.drugs.filter((drug) => drug.group === group);
      pageContainer.querySelector("tbody").innerHTML = rows.length ? rows.map((drug) => `<tr><td><div class="medicine-cell"><span class="medicine-thumb">✚</span><span><strong>${esc(drug.name)}</strong><small>${esc(drug.id)}</small></span></div></td><td><span class="pill ${groupClass(drug.group)}">${groupLabel(drug.group)}</span></td><td>1 ${esc(drug.largeUnit)} = ${drug.conversion} ${esc(drug.smallUnit)}</td><td>${rupiah(drug.retail)}</td><td>${rupiah(drug.wholesale)}</td><td><strong>${drugStock(drug.id)}</strong> ${esc(drug.smallUnit)}</td><td>${stockPill(drugStock(drug.id), drug.min)}</td><td>${currentUser.role === "admin" ? `<button class="row-actions" data-action="drug-menu" data-id="${esc(drug.id)}">···</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="8" class="empty-state">Obat tidak ditemukan.</td></tr>`;
    } else { renderDrugs(); }
  });
  bindPageActions();
}

function renderBatches() {
  const today = dateInputValue();
  const rows = [...state.batches].sort((a, b) => a.expiry.localeCompare(b.expiry));
  pageContainer.innerHTML = `${pageHeading("Stok & Batch", "Pantau persediaan per batch dan prioritaskan FEFO (First Expired, First Out).", currentUser.role === "admin" ? `<button class="button" data-action="add-batch"><span class="plus">＋</span>Tambah Batch</button>` : "")}
    <div class="info-banner"><span>ⓘ</span><span>Stok selalu dicatat dalam satuan terkecil. Sistem akan mengeluarkan batch dengan tanggal kedaluwarsa terdekat terlebih dahulu saat penjualan.</span></div>
    <section class="panel table-panel"><div class="table-toolbar"><div class="table-toolbar-left"><label class="search-box"><span>⌕</span><input id="batch-search" placeholder="Cari obat atau nomor batch..." value="${esc(currentFilter)}"/></label><select class="select-control" id="batch-status"><option value="">Semua status</option><option>Aktif</option><option>Karantina_ED</option><option>Habis</option></select></div><span style="color:#9aa49d;font-size:10px">${rows.length} batch tercatat</span></div>
    <div class="table-wrap"><table><thead><tr><th>NAMA OBAT</th><th>NO. BATCH</th><th>TANGGAL ED</th><th>HPP / ${esc(state.drugs[0]?.smallUnit || "unit")}</th><th>STOK TERSEDIA</th><th>STATUS</th><th></th></tr></thead><tbody id="batch-rows"></tbody></table></div><div class="table-foot"><span>Urutan berdasarkan tanggal kedaluwarsa</span><span>${rows.length} batch</span></div></section>`;
  const drawRows = () => {
    const query = currentFilter.toLowerCase();
    const status = document.getElementById("batch-status").value;
    const visible = rows.filter((batch) => {
      const drug = drugById(batch.drugId);
      return (!query || `${drug?.name} ${batch.number}`.toLowerCase().includes(query)) && (!status || batch.status === status);
    });
    document.getElementById("batch-rows").innerHTML = visible.length ? visible.map((batch) => {
      const drug = drugById(batch.drugId);
      const days = Math.ceil((new Date(`${batch.expiry}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
      const expiryStatus = days < 0 ? `<span class="pill red">Kedaluwarsa</span>` : days <= 90 ? `<span class="pill orange">Segera ED</span>` : `<span class="pill green">Aman</span>`;
      return `<tr><td><div class="medicine-cell"><span class="medicine-thumb">✚</span><span><strong>${esc(drug?.name || batch.drugId)}</strong><small>${esc(batch.drugId)}</small></span></div></td><td>${esc(batch.number)}</td><td>${dateLabel(batch.expiry)}<div style="margin-top:4px">${expiryStatus}</div></td><td>${rupiah(batch.cost)}</td><td><strong>${batch.stock}</strong> ${esc(drug?.smallUnit || "unit")}</td><td>${statusPill(batch.status)}</td><td>${currentUser.role === "admin" && batch.stock > 0 ? `<button class="row-actions" data-action="batch-menu" data-id="${batch.id}">···</button>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty-state">Batch tidak ditemukan.</td></tr>`;
  };
  document.getElementById("batch-search").addEventListener("input", (event) => { currentFilter = event.target.value; drawRows(); });
  document.getElementById("batch-status").addEventListener("change", drawRows);
  drawRows();
  bindPageActions();
}

function renderIncoming() {
  const incomingRows = [...state.incoming].sort((a, b) => new Date(b.date) - new Date(a.date));
  pageContainer.innerHTML = `${pageHeading("Barang Masuk", "Catat penerimaan obat dari PBF beserta batch, harga beli, dan tanggal kedaluwarsa.", `<button class="button" data-action="add-incoming"><span class="plus">＋</span>Catat Barang Masuk</button>`)}
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-top"><span>Total Penerimaan</span><span class="stat-icon">↙</span></div><div class="stat-value">${incomingRows.length}</div><div class="stat-foot">Dokumen barang masuk</div></div>
      <div class="stat-card"><div class="stat-top"><span>Tagihan Tempo</span><span class="stat-icon orange">◷</span></div><div class="stat-value">${rupiah(incomingRows.filter((item) => item.method === "Tempo").reduce((sum, item) => sum + item.total, 0))}</div><div class="stat-foot">Belum termasuk data demo</div></div>
      <div class="stat-card"><div class="stat-top"><span>Item Batch Aktif</span><span class="stat-icon blue">▦</span></div><div class="stat-value">${state.batches.filter((batch) => batch.status === "Aktif").length}</div><div class="stat-foot">Batch dengan stok tersedia</div></div>
      <div class="stat-card"><div class="stat-top"><span>Terakhir Diperbarui</span><span class="stat-icon pink">◷</span></div><div class="stat-value" style="font-size:16px">${incomingRows[0] ? dateLabel(incomingRows[0].date, true) : "Belum ada"}</div><div class="stat-foot">Penerimaan PBF terbaru</div></div>
    </div>
    <section class="panel table-panel"><div class="panel-header"><div><h2>Riwayat Barang Masuk</h2><p>Dokumen penerimaan dari pemasok</p></div><button class="button secondary small" data-action="add-incoming">＋ Catat Penerimaan</button></div><div class="table-wrap"><table><thead><tr><th>NO. FAKTUR PBF</th><th>NAMA PBF</th><th>TANGGAL MASUK</th><th>METODE BAYAR</th><th>JATUH TEMPO</th><th>TOTAL TAGIHAN</th><th>ITEM</th></tr></thead><tbody>${incomingRows.length ? incomingRows.map((item) => `<tr><td><strong>${esc(item.invoice)}</strong></td><td>${esc(item.supplier)}</td><td>${dateLabel(item.date, true)}</td><td><span class="pill ${item.method === "Lunas" ? "green" : "orange"}">${item.method}</span></td><td>${item.due ? dateLabel(item.due) : "—"}</td><td><strong>${rupiah(item.total)}</strong></td><td>${item.itemCount} item</td></tr>`).join("") : `<tr><td colspan="7" class="empty-state">Belum ada barang masuk. Catat penerimaan PBF untuk menambahkan stok.</td></tr>`}</tbody></table></div></section>`;
  bindPageActions();
}

function renderSale(isWholesale) {
  const page = isWholesale ? "Penjualan Grosir" : "Kasir Ecer";
  const selectedItems = activeCart.map((item) => ({ ...item, drug: drugById(item.drugId) })).filter((item) => item.drug);
  const subtotal = selectedItems.reduce((sum, item) => sum + item.qty * (isWholesale ? item.drug.wholesale : item.drug.retail), 0);
  const discount = Number(document.getElementById("sale-discount")?.value || 0);
  const total = Math.max(0, subtotal - discount);
  const title = isWholesale ? "Penjualan Grosir" : "Kasir Ecer";
  const desc = isWholesale ? "Buat faktur penjualan untuk pelanggan grosir dan kelola status pengiriman." : "Layani pelanggan, tambahkan obat ke keranjang, dan proses pembayaran.";
  pageContainer.innerHTML = `${pageHeading(title, desc)}
    ${!isWholesale ? `<div class="info-banner"><span>ⓘ</span><span>Penjualan akan mengurangi stok berdasarkan batch dengan tanggal kedaluwarsa terdekat (FEFO). <strong>Obat keras wajib menyertakan nomor resep.</strong></span></div>` : ""}
    <div class="two-column"><section class="panel form-panel"><h2>${isWholesale ? "Informasi Faktur" : "Informasi Transaksi"}</h2><p>Lengkapi detail transaksi dan pilih obat yang dibeli.</p>
      <div class="form-grid">
        ${isWholesale ? `<div class="field full"><label for="sale-customer">Pelanggan / Apotek *</label><select id="sale-customer"><option value="">Pilih pelanggan</option>${state.customers.map((customer) => `<option value="${customer.id}">${esc(customer.name)}</option>`).join("")}<option value="new">＋ Tambah pelanggan baru</option></select></div><div class="field full" id="new-customer-wrap" style="display:none"><label for="new-customer">Nama pelanggan baru *</label><input id="new-customer" placeholder="Nama apotek / klinik"/></div>` : `<div class="field"><label for="sale-customer-type">Tipe pelanggan</label><select id="sale-customer-type"><option>Umum</option><option>Pelanggan_Member</option></select></div><div class="field"><label for="sale-prescription">No. resep <span style="font-weight:400;color:#9aa49d">(wajib obat keras)</span></label><input id="sale-prescription" placeholder="Contoh: R/251126/001"/></div>`}
        <div class="field"><label for="sale-drug">Pilih obat</label><select id="sale-drug"><option value="">Pilih obat untuk ditambahkan</option>${state.drugs.map((drug) => `<option value="${esc(drug.id)}">${esc(drug.name)} · stok ${drugStock(drug.id)} ${esc(drug.smallUnit)}</option>`).join("")}</select></div>
        <div class="field"><label for="sale-qty">${isWholesale ? "Jumlah (satuan besar)" : "Jumlah (satuan kecil)"}</label><div style="display:flex;gap:7px"><input id="sale-qty" type="number" min="1" value="1" style="flex:1"/><button class="button secondary" id="add-to-cart">Tambah</button></div><span class="field-note">${isWholesale ? "Jumlah akan dihitung dalam satuan besar." : "Jumlah dalam satuan ecer / terkecil."}</span></div>
      </div>
      <div class="order-items"><div style="display:flex;justify-content:space-between;color:#8b978f;font-size:9px;padding:0 0 9px"><span>ITEM KERANJANG</span><span>${selectedItems.length} item</span></div>
        ${selectedItems.length ? selectedItems.map((item) => `<div class="order-item"><span><strong>${esc(item.drug.name)}</strong><small>${rupiah(isWholesale ? item.drug.wholesale : item.drug.retail)} / ${esc(isWholesale ? item.drug.largeUnit : item.drug.smallUnit)}</small></span><input class="cart-qty" data-drug="${esc(item.drug.id)}" type="number" min="1" value="${item.qty}" aria-label="Jumlah ${esc(item.drug.name)}"/><span class="line-total">${rupiah(item.qty * (isWholesale ? item.drug.wholesale : item.drug.retail))}</span><button class="remove-item" data-remove="${esc(item.drug.id)}" aria-label="Hapus item">×</button></div>`).join("") : `<div class="empty-state" style="padding:18px">Keranjang masih kosong. Pilih obat di atas untuk memulai.</div>`}
      </div>
    </section>
    <aside class="panel form-panel"><h2>Ringkasan Pembayaran</h2><p>Periksa total sebelum menyelesaikan transaksi.</p><div class="summary-card">
      ${isWholesale ? `<div class="field" style="margin-bottom:13px"><label for="sale-discount">Diskon pelanggan (Rp)</label><input id="sale-discount" type="number" min="0" value="${discount}" placeholder="0"/></div>` : ""}
      <div class="summary-row"><span>Subtotal (${selectedItems.length} item)</span><strong>${rupiah(subtotal)}</strong></div>${isWholesale ? `<div class="summary-row"><span>Diskon</span><strong>− ${rupiah(discount)}</strong></div>` : ""}
      <div class="summary-row summary-total"><span>Total tagihan</span><strong>${rupiah(total)}</strong></div>
    </div>
    <div class="form-grid" style="margin-top:15px">
      <div class="field full"><label for="sale-method">Metode pembayaran *</label><select id="sale-method">${isWholesale ? `<option>Tunai</option><option>Transfer</option><option>Tempo</option>` : `<option>Tunai</option><option>Transfer_QRIS</option>`}</select></div>
      ${!isWholesale ? `<div class="field full"><label for="sale-cash">Uang diterima (Rp)</label><input id="sale-cash" type="number" min="0" placeholder="${Math.ceil(total)}"/></div><div class="field full"><label>Kembalian</label><div id="sale-change" class="field-note" style="font-size:13px;color:#17835e;font-weight:700">Rp0</div></div>` : `<div class="field full" id="sale-due-wrap" style="display:none"><label for="sale-due">Tanggal jatuh tempo *</label><input id="sale-due" type="date"/></div>`}
      <div class="field full"><label for="sale-note">${isWholesale ? "Catatan pengiriman" : "Catatan"} <span style="font-weight:400;color:#9aa49d">(opsional)</span></label><input id="sale-note" placeholder="Tambahkan catatan..."/></div>
    </div>
    <div class="form-actions"><button class="button" id="complete-sale" style="width:100%;min-height:40px">${isWholesale ? "Buat Faktur" : "Proses Pembayaran"} <span>→</span></button></div>
    </aside></div>
    ${isWholesale ? `<section class="panel table-panel"><div class="panel-header"><div><h2>Faktur Grosir Terbaru</h2><p>Pantau pembayaran dan status penyiapan pesanan.</p></div></div><div class="table-wrap"><table><thead><tr><th>NO. FAKTUR</th><th>TANGGAL</th><th>PELANGGAN</th><th>PEMBAYARAN</th><th>TOTAL</th><th>STATUS GUDANG</th><th></th></tr></thead><tbody>${state.transactions.filter((transaction) => transaction.type === "Jual_Grosir").slice(0, 10).map((transaction) => `<tr><td><strong>${esc(transaction.id)}</strong></td><td>${dateLabel(transaction.date, true)}</td><td>${esc(transaction.customer)}</td><td><span class="pill ${transaction.status === "Belum_Lunas" ? "orange" : "green"}">${esc((transaction.status || "Lunas").replaceAll("_", " "))}</span>${transaction.due ? `<div class="field-note" style="margin-top:4px">Tempo s.d. ${dateLabel(transaction.due)}</div>` : ""}</td><td><strong>${rupiah(transaction.total)}</strong></td><td><span class="pill ${transaction.warehouseStatus === "Selesai_Dikirim" ? "green" : "orange"}">${esc((transaction.warehouseStatus || "Menunggu_Penyiapan").replaceAll("_", " "))}</span></td><td>${currentUser.role === "admin" && transaction.warehouseStatus !== "Selesai_Dikirim" ? `<button class="button secondary small" data-action="ship-wholesale" data-id="${esc(transaction.id)}">Tandai dikirim</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty-state">Belum ada faktur grosir.</td></tr>`}</tbody></table></div></section>` : ""}`;
  bindPageActions();
  const select = document.getElementById("sale-customer");
  select?.addEventListener("change", () => { document.getElementById("new-customer-wrap").style.display = select.value === "new" ? "flex" : "none"; });
  document.getElementById("sale-method")?.addEventListener("change", (event) => {
    if (isWholesale) document.getElementById("sale-due-wrap").style.display = event.target.value === "Tempo" ? "flex" : "none";
  });
  document.getElementById("sale-drug")?.addEventListener("change", () => { document.getElementById("sale-qty").value = 1; });
  document.getElementById("add-to-cart")?.addEventListener("click", () => {
    const drugId = document.getElementById("sale-drug").value;
    const qty = Math.floor(Number(document.getElementById("sale-qty").value));
    const drug = drugById(drugId);
    if (!drug) return toast("Pilih obat terlebih dahulu.", true);
    if (!Number.isInteger(qty) || qty < 1) return toast("Jumlah harus lebih dari 0.", true);
    const needed = qty * (isWholesale ? drug.conversion : 1);
    const already = activeCart.find((item) => item.drugId === drugId)?.qty || 0;
    if (already * (isWholesale ? drug.conversion : 1) + needed > drugStock(drugId)) return toast(`Stok ${drug.name} tidak mencukupi.`, true);
    const found = activeCart.find((item) => item.drugId === drugId);
    if (found) found.qty += qty;
    else activeCart.push({ drugId, qty });
    renderSale(isWholesale);
  });
  document.querySelectorAll(".cart-qty").forEach((input) => input.addEventListener("change", () => {
    const item = activeCart.find((row) => row.drugId === input.dataset.drug);
    const drug = drugById(input.dataset.drug);
    const qty = Math.floor(Number(input.value));
    const multiplier = isWholesale ? drug.conversion : 1;
    if (!item || !Number.isInteger(qty) || qty < 1 || qty * multiplier > drugStock(drug.id)) {
      toast("Jumlah tidak valid atau stok tidak mencukupi.", true);
      return renderSale(isWholesale);
    }
    item.qty = qty;
    renderSale(isWholesale);
  }));
  document.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    activeCart = activeCart.filter((item) => item.drugId !== button.dataset.remove);
    renderSale(isWholesale);
  }));
  document.getElementById("sale-discount")?.addEventListener("input", () => renderSale(isWholesale));
  document.getElementById("sale-cash")?.addEventListener("input", (event) => {
    const cash = Number(event.target.value) || 0;
    const currentSubtotal = activeCart.reduce((sum, item) => {
      const drug = drugById(item.drugId);
      return sum + item.qty * (drug?.retail || 0);
    }, 0);
    document.getElementById("sale-change").textContent = rupiah(Math.max(0, cash - currentSubtotal));
  });
  document.getElementById("complete-sale")?.addEventListener("click", () => completeSale(isWholesale));
}

async function completeSale(isWholesale) {
  if (!activeCart.length) return toast("Keranjang masih kosong.", true);
  const customerSelect = document.getElementById("sale-customer");
  const selectedCustomer = customerSelect?.value;
  let customerName = document.getElementById("sale-customer-type")?.value || "Umum";
  if (isWholesale) {
    if (selectedCustomer === "new") {
      customerName = document.getElementById("new-customer").value.trim();
      if (!customerName) return toast("Nama pelanggan wajib diisi.", true);
    } else {
      const customer = state.customers.find((item) => String(item.id) === selectedCustomer);
      if (!customer) return toast("Pilih pelanggan terlebih dahulu.", true);
      customerName = customer.name;
    }
  }
  const prescription = document.getElementById("sale-prescription")?.value.trim();
  if (!isWholesale && activeCart.some((item) => ["Keras_Merah", "Psikotropika"].includes(drugById(item.drugId)?.group)) && !prescription) return toast("Nomor resep wajib diisi untuk obat keras atau psikotropika.", true);
  const method = document.getElementById("sale-method").value;
  const due = document.getElementById("sale-due")?.value;
  if (isWholesale && method === "Tempo" && !due) return toast("Tanggal jatuh tempo wajib diisi untuk pembayaran tempo.", true);
  const sub = activeCart.reduce((sum, item) => {
    const drug = drugById(item.drugId);
    return sum + item.qty * (isWholesale ? drug.wholesale : drug.retail);
  }, 0);
  const discount = isWholesale ? Number(document.getElementById("sale-discount").value) || 0 : 0;
  if (discount > sub) return toast("Diskon tidak boleh melebihi subtotal.", true);
  const total = sub - discount;
  const cashInput = document.getElementById("sale-cash")?.value;
  const cash = Number(cashInput);
  if (!isWholesale && method === "Tunai" && (!cashInput || !Number.isFinite(cash) || cash < total)) return toast("Masukkan uang diterima yang mencukupi.", true);
  for (const item of activeCart) {
    const drug = drugById(item.drugId);
    const qty = item.qty * (isWholesale ? drug.conversion : 1);
    if (drugStock(drug.id) < qty) return toast(`Stok ${drug.name} berubah dan tidak lagi mencukupi.`, true);
  }
  const completeButton = document.getElementById("complete-sale");
  completeButton.disabled = true;
  try {
    const result = await apiRequest("/sales", {
      method: "POST",
      body: {
        type: isWholesale ? "Jual_Grosir" : "Jual_Ecer",
        items: activeCart,
        method,
        discount,
        customerId: isWholesale && selectedCustomer !== "new" ? Number(selectedCustomer) : null,
        customerName: isWholesale && selectedCustomer === "new" ? customerName : null,
        customerType: document.getElementById("sale-customer-type")?.value,
        prescription,
        due,
        cashReceived: isWholesale || method === "Transfer_QRIS" ? total : cash,
      },
    });
    activeCart = [];
    toast(`${isWholesale ? "Faktur" : "Transaksi"} ${result.id} berhasil disimpan.`);
    await refreshState();
    setPage(isWholesale ? "grosir" : "dashboard");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (completeButton.isConnected) completeButton.disabled = false;
  }
}

function renderStockCard() {
  const logs = [...state.logs].sort((a, b) => new Date(b.date) - new Date(a.date));
  const filtered = logs.filter((log) => {
    const batch = state.batches.find((item) => item.id === log.batchId);
    const drug = batch && drugById(batch.drugId);
    return !currentFilter || `${log.reference} ${drug?.name} ${batch?.number} ${log.type}`.toLowerCase().includes(currentFilter.toLowerCase());
  });
  pageContainer.innerHTML = `${pageHeading("Kartu Stok", "Riwayat mutasi persediaan yang tercatat untuk keperluan audit.", `<button class="button secondary" data-action="export-stock">↓ Ekspor CSV</button>`)}
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-top"><span>Total Mutasi</span><span class="stat-icon">≋</span></div><div class="stat-value">${state.logs.length}</div><div class="stat-foot">Seluruh pergerakan stok</div></div>
      <div class="stat-card"><div class="stat-top"><span>Barang Masuk</span><span class="stat-icon blue">↙</span></div><div class="stat-value">${state.logs.filter((log) => log.in > 0).length}</div><div class="stat-foot">Mutasi penambahan stok</div></div>
      <div class="stat-card"><div class="stat-top"><span>Barang Keluar</span><span class="stat-icon orange">↗</span></div><div class="stat-value">${state.logs.filter((log) => log.out > 0).length}</div><div class="stat-foot">Mutasi penjualan</div></div>
      <div class="stat-card"><div class="stat-top"><span>Jumlah Jenis Obat</span><span class="stat-icon pink">▤</span></div><div class="stat-value">${state.drugs.length}</div><div class="stat-foot">Dalam master obat</div></div>
    </div><section class="panel table-panel"><div class="table-toolbar"><div class="table-toolbar-left"><label class="search-box"><span>⌕</span><input id="log-search" placeholder="Cari obat atau dokumen..." value="${esc(currentFilter)}"/></label><select class="select-control" id="log-type"><option value="">Semua mutasi</option><option value="Masuk_PBF">Masuk PBF</option><option value="Jual_Ecer">Jual Ecer</option><option value="Jual_Grosir">Jual Grosir</option></select></div><span style="color:#9aa49d;font-size:10px">${filtered.length} catatan</span></div>
    <div class="table-wrap"><table><thead><tr><th>WAKTU</th><th>OBAT / BATCH</th><th>JENIS MUTASI</th><th>REFERENSI</th><th>QTY MASUK</th><th>QTY KELUAR</th><th>SISA STOK</th></tr></thead><tbody id="log-rows"></tbody></table></div><div class="table-foot"><span>Log mutasi dicatat otomatis saat barang masuk dan penjualan</span><span>${filtered.length} mutasi</span></div></section>`;
  const draw = () => {
    const type = document.getElementById("log-type").value;
    const query = currentFilter.toLowerCase();
    const entries = logs.filter((log) => {
      const batch = state.batches.find((item) => item.id === log.batchId);
      const drug = batch && drugById(batch.drugId);
      return (!query || `${log.reference} ${drug?.name} ${batch?.number} ${log.type}`.toLowerCase().includes(query)) && (!type || log.type === type);
    });
    document.getElementById("log-rows").innerHTML = entries.length ? entries.map((log) => {
      const batch = state.batches.find((item) => item.id === log.batchId);
      const drug = batch && drugById(batch.drugId);
      const typeLabel = ({ Masuk_PBF: "Masuk PBF", Jual_Ecer: "Jual Ecer", Jual_Grosir: "Jual Grosir", Retur: "Retur", Opname: "Opname" })[log.type] || log.type;
      return `<tr><td>${dateLabel(log.date, true)}</td><td><div class="medicine-cell"><span class="medicine-thumb">✚</span><span><strong>${esc(drug?.name || "Obat dihapus")}</strong><small>Batch ${esc(batch?.number || "—")}</small></span></div></td><td><span class="pill ${log.in ? "green" : "blue"}">${typeLabel}</span></td><td><strong>${esc(log.reference)}</strong></td><td style="color:#23815a">${log.in ? `+${log.in}` : "—"}</td><td style="color:#c3655e">${log.out ? `−${log.out}` : "—"}</td><td><strong>${log.balance}</strong> ${esc(drug?.smallUnit || "unit")}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty-state">Catatan mutasi tidak ditemukan.</td></tr>`;
  };
  document.getElementById("log-search").addEventListener("input", (event) => { currentFilter = event.target.value; draw(); });
  document.getElementById("log-type").addEventListener("change", draw);
  draw();
  bindPageActions();
}

async function renderUsers() {
  const users = await apiRequest("/users");
  if (activePage !== "users") return;
  pageContainer.innerHTML = `${pageHeading("Akun Pengguna", "Buat akun staf dan atur siapa yang dapat mengakses sistem.", `<button class="button" data-action="add-user"><span class="plus">＋</span>Tambah Pengguna</button>`)}
    <div class="info-banner"><span>ⓘ</span><span>Gunakan akun terpisah untuk setiap staf. Kata sandi awal minimal 14 karakter; bagikan melalui saluran pribadi dan minta staf menggantinya sebelum operasional.</span></div>
    <section class="panel table-panel"><div class="panel-header"><div><h2>Pengguna Sistem</h2><p>Akun aktif dapat masuk ke aplikasi menggunakan email.</p></div><span class="pill green">${users.filter((user) => user.active).length} aktif</span></div>
    <div class="table-wrap"><table><thead><tr><th>NAMA</th><th>EMAIL</th><th>PERAN</th><th>DIBUAT</th><th>STATUS</th><th></th></tr></thead><tbody>${users.map((user) => `<tr><td><strong>${esc(user.name)}</strong></td><td>${esc(user.email)}</td><td><span class="pill ${user.role === "admin" ? "blue" : "gray"}">${user.role === "admin" ? "Administrator" : "Kasir"}</span></td><td>${dateLabel(user.createdAt)}</td><td><span class="pill ${user.active ? "green" : "red"}">${user.active ? "Aktif" : "Nonaktif"}</span></td><td>${Number(user.id) === Number(currentUser.id) ? `<span class="field-note">Akun Anda</span>` : `<button class="button ${user.active ? "danger" : "secondary"} small" data-action="toggle-user" data-id="${user.id}" data-active="${!user.active}">${user.active ? "Nonaktifkan" : "Aktifkan"}</button>`}</td></tr>`).join("")}</tbody></table></div></section>`;
  bindPageActions();
}

function showUserModal() {
  openModal("Tambah Pengguna", "Buat akun administrator atau kasir baru.", `<div class="form-grid">
    <div class="field full"><label for="user-name">Nama lengkap *</label><input id="user-name" name="name" required maxlength="120" placeholder="Nama staf"/></div>
    <div class="field full"><label for="user-email">Email untuk login *</label><input id="user-email" name="email" type="email" required maxlength="190" placeholder="staf@apotek.id"/></div>
    <div class="field full"><label for="user-role">Peran *</label><select id="user-role" name="role"><option value="kasir">Kasir — transaksi dan melihat data</option><option value="admin">Administrator — pengaturan dan inventaris</option></select></div>
    <div class="field full"><label for="user-password">Kata sandi sementara *</label><input id="user-password" name="password" type="password" required minlength="14" maxlength="72" autocomplete="new-password" placeholder="Minimal 14 karakter"/><span class="field-note">Maksimal 72 byte. Kata sandi disimpan dalam bentuk hash; jangan memakai kata sandi yang sama dengan akun lain.</span></div>
  </div>`, async (form) => {
    await apiRequest("/users", {
      method: "POST",
      body: { name: String(form.get("name")).trim(), email: String(form.get("email")).trim(), role: form.get("role"), password: form.get("password") },
    });
    closeModal();
    await renderUsers();
    toast("Akun pengguna berhasil dibuat.");
  });
}

function showPasswordModal() {
  openModal("Ubah Kata Sandi", "Kata sandi baru harus berbeda dan minimal 14 karakter.", `<div class="form-grid">
    <div class="field full"><label for="current-password">Kata sandi saat ini *</label><input id="current-password" name="currentPassword" type="password" required autocomplete="current-password"/></div>
    <div class="field full"><label for="new-password">Kata sandi baru *</label><input id="new-password" name="newPassword" type="password" required minlength="14" maxlength="72" autocomplete="new-password"/></div>
    <div class="field full"><label for="confirm-password">Ulangi kata sandi baru *</label><input id="confirm-password" type="password" required minlength="14" maxlength="72" autocomplete="new-password"/></div>
  </div>`, async (form) => {
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== document.getElementById("confirm-password").value) return toast("Konfirmasi kata sandi tidak sama.", true);
    await apiRequest("/me/password", { method: "POST", body: { currentPassword: form.get("currentPassword"), newPassword } });
    closeModal();
    toast("Kata sandi berhasil diubah. Sesi lain telah dikeluarkan.");
  });
}

function openModal(title, subtitle, body, onSubmit, submitLabel = "Simpan") {
  modalLayer.innerHTML = `<form class="modal" id="modal-form"><div class="modal-header"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="modal-close" type="button" aria-label="Tutup">×</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button class="button secondary" type="button" data-close>Batalkan</button><button class="button" type="submit">${submitLabel}</button></div></form>`;
  modalLayer.classList.add("open");
  modalLayer.querySelector(".modal-close").addEventListener("click", closeModal);
  modalLayer.querySelector("[data-close]").addEventListener("click", closeModal);
  modalLayer.addEventListener("click", (event) => { if (event.target === modalLayer) closeModal(); }, { once: true });
  const formElement = modalLayer.querySelector("form");
  const submitButton = formElement.querySelector('[type="submit"]');
  formElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    try {
      await onSubmit(new FormData(event.currentTarget));
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (formElement.isConnected) submitButton.disabled = false;
    }
  });
}

function closeModal() {
  modalLayer.classList.remove("open");
  modalLayer.innerHTML = "";
}

function drugForm(drug = {}) {
  return `<div class="form-grid">
    <div class="field"><label for="drug-id">Kode obat *</label><input id="drug-id" name="id" required maxlength="20" value="${esc(drug.id || nextId("OBT-", state.drugs))}" ${drug.id ? "readonly" : ""}/></div>
    <div class="field"><label for="drug-name">Nama obat *</label><input id="drug-name" name="name" required maxlength="150" value="${esc(drug.name || "")}" placeholder="Contoh: Paracetamol 500 mg"/></div>
    <div class="field"><label for="drug-group">Golongan *</label><select id="drug-group" name="group" required><option value="Bebas_Hijau" ${drug.group === "Bebas_Hijau" ? "selected" : ""}>Bebas (Hijau)</option><option value="Bebas_Terbatas_Biru" ${drug.group === "Bebas_Terbatas_Biru" ? "selected" : ""}>Bebas Terbatas (Biru)</option><option value="Keras_Merah" ${drug.group === "Keras_Merah" ? "selected" : ""}>Obat Keras (Merah)</option><option value="Psikotropika" ${drug.group === "Psikotropika" ? "selected" : ""}>Psikotropika</option></select></div>
    <div class="field"><label for="drug-conversion">Isi konversi *</label><input id="drug-conversion" name="conversion" type="number" min="1" required value="${drug.conversion || 10}"/></div>
    <div class="field"><label for="drug-large">Satuan besar</label><input id="drug-large" name="largeUnit" maxlength="30" value="${esc(drug.largeUnit || "Box")}"/></div>
    <div class="field"><label for="drug-small">Satuan kecil</label><input id="drug-small" name="smallUnit" maxlength="30" value="${esc(drug.smallUnit || "Strip")}"/></div>
    <div class="field"><label for="drug-retail">Harga jual ecer (Rp) *</label><input id="drug-retail" name="retail" type="number" min="0" required value="${drug.retail ?? ""}"/></div>
    <div class="field"><label for="drug-wholesale">Harga jual grosir (Rp) *</label><input id="drug-wholesale" name="wholesale" type="number" min="0" required value="${drug.wholesale ?? ""}"/></div>
    <div class="field"><label for="drug-min">Stok minimal</label><input id="drug-min" name="min" type="number" min="0" value="${drug.min ?? 10}"/></div>
  </div>`;
}

function showDrugModal(drug = null) {
  openModal(drug ? "Edit Data Obat" : "Tambah Obat Baru", "Lengkapi informasi dasar obat dan harga jual.", drugForm(drug || {}), async (form) => {
    const conversion = Number(form.get("conversion"));
    const retail = Number(form.get("retail"));
    const wholesale = Number(form.get("wholesale"));
    const min = Number(form.get("min"));
    if (![conversion, retail, wholesale, min].every(Number.isFinite) || conversion < 1 || retail < 0 || wholesale < 0 || min < 0) return toast("Periksa kembali nilai harga, konversi, dan stok minimal.", true);
    const record = { id: String(form.get("id")).trim(), name: String(form.get("name")).trim(), group: form.get("group"), largeUnit: String(form.get("largeUnit")).trim() || "Box", smallUnit: String(form.get("smallUnit")).trim() || "Strip", conversion, retail, wholesale, min };
    if (!record.name) return toast("Nama obat wajib diisi.", true);
    await apiRequest(drug ? `/drugs/${encodeURIComponent(drug.id)}` : "/drugs", { method: drug ? "PUT" : "POST", body: record });
    closeModal();
    await refreshState();
    toast(drug ? "Data obat berhasil diperbarui." : "Obat berhasil ditambahkan.");
  });
}

function showBatchModal() {
  const activeDrugs = state.drugs;
  openModal("Tambah Batch Stok", "Masukkan detail batch baru. Stok dicatat dalam satuan terkecil.", `<div class="form-grid">
    <div class="field full"><label for="batch-drug">Nama obat *</label><select id="batch-drug" name="drugId" required>${activeDrugs.map((drug) => `<option value="${esc(drug.id)}">${esc(drug.name)} · ${esc(drug.smallUnit)}</option>`).join("")}</select></div>
    <div class="field"><label for="batch-number">Nomor batch *</label><input id="batch-number" name="number" required maxlength="50" placeholder="Contoh: PCM250301"/></div>
    <div class="field"><label for="batch-expiry">Tanggal kedaluwarsa *</label><input id="batch-expiry" name="expiry" type="date" required min="${dateInputValue()}"/></div>
    <div class="field"><label for="batch-cost">Harga beli / satuan kecil *</label><input id="batch-cost" name="cost" type="number" min="0" required placeholder="0"/></div>
    <div class="field"><label for="batch-stock">Stok awal (satuan kecil) *</label><input id="batch-stock" name="stock" type="number" min="1" required placeholder="0"/></div>
  </div>`, async (form) => {
    const stock = Number(form.get("stock"));
    const cost = Number(form.get("cost"));
    const number = String(form.get("number")).trim();
    if (!number || !Number.isInteger(stock) || stock < 1 || !Number.isFinite(cost) || cost < 0) return toast("Isi nomor batch, stok, dan harga beli dengan benar.", true);
    await apiRequest("/batches", { method: "POST", body: { drugId: form.get("drugId"), number, expiry: form.get("expiry"), cost, stock } });
    closeModal();
    await refreshState();
    toast("Batch dan stok berhasil ditambahkan.");
  });
}

function showIncomingModal() {
  let items = [];
  openModal("Catat Barang Masuk", "Terima obat dari PBF dan perbarui stok berdasarkan batch.", `<div class="form-grid">
    <div class="field"><label for="incoming-invoice">No. faktur PBF *</label><input id="incoming-invoice" name="invoice" required placeholder="Contoh: PBF/INV/001"/></div>
    <div class="field"><label for="incoming-supplier">Nama PBF *</label><input id="incoming-supplier" name="supplier" required placeholder="Nama pemasok"/></div>
    <div class="field"><label for="incoming-method">Metode bayar *</label><select id="incoming-method" name="method"><option>Lunas</option><option>Tempo</option></select></div>
    <div class="field" id="incoming-due-wrap" style="display:none"><label for="incoming-due">Tanggal jatuh tempo</label><input id="incoming-due" name="due" type="date"/></div>
    <div class="field"><label for="incoming-drug">Nama obat *</label><select id="incoming-drug">${state.drugs.map((drug) => `<option value="${esc(drug.id)}">${esc(drug.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="incoming-batch">Nomor batch *</label><input id="incoming-batch" placeholder="Nomor batch"/></div>
    <div class="field"><label for="incoming-expiry">Tanggal kedaluwarsa *</label><input id="incoming-expiry" type="date" min="${dateInputValue()}"/></div>
    <div class="field"><label for="incoming-cost">Harga beli / satuan kecil (Rp) *</label><input id="incoming-cost" type="number" min="0" placeholder="0"/></div>
    <div class="field"><label for="incoming-qty">Jumlah masuk (satuan kecil) *</label><input id="incoming-qty" type="number" min="1" placeholder="0"/></div>
    <div class="field" style="align-self:end"><button class="button secondary" type="button" id="incoming-add-item" style="width:100%">＋ Tambahkan item</button></div>
    <div class="field full"><div id="incoming-items" class="summary-card" style="font-size:10px;color:#849087">Belum ada item. Tambahkan minimal satu item untuk menyimpan.</div></div>
  </div>`, async (form) => {
    if (!items.length) return toast("Tambahkan minimal satu item barang masuk.", true);
    const invoice = String(form.get("invoice")).trim();
    const method = form.get("method");
    const due = form.get("due");
    if (method === "Tempo" && !due) return toast("Tanggal jatuh tempo wajib diisi untuk pembayaran tempo.", true);
    await apiRequest("/incoming", {
      method: "POST",
      body: { invoice, supplier: String(form.get("supplier")).trim(), method, due: due || null, items },
    });
    closeModal();
    await refreshState();
    toast(`Barang masuk ${invoice} berhasil dicatat.`);
  });
  document.getElementById("incoming-method").addEventListener("change", (event) => {
    document.getElementById("incoming-due-wrap").style.display = event.target.value === "Tempo" ? "flex" : "none";
  });
  document.getElementById("incoming-add-item").addEventListener("click", () => {
    const drugId = document.getElementById("incoming-drug").value;
    const number = document.getElementById("incoming-batch").value.trim();
    const expiry = document.getElementById("incoming-expiry").value;
    const cost = Number(document.getElementById("incoming-cost").value);
    const qty = Number(document.getElementById("incoming-qty").value);
    if (!number || !expiry || !Number.isInteger(qty) || qty < 1 || !Number.isFinite(cost) || cost < 0) return toast("Lengkapi nomor batch, tanggal ED, harga, dan jumlah.", true);
    if (new Date(`${expiry}T00:00:00`) < new Date(`${dateInputValue()}T00:00:00`)) return toast("Tanggal kedaluwarsa tidak boleh di masa lalu.", true);
    if (items.some((item) => item.number === number && item.drugId === drugId)) return toast("Batch tersebut sudah ada di daftar item.", true);
    items.push({ drugId, number, expiry, cost, qty });
    document.getElementById("incoming-items").innerHTML = items.map((item) => `<div class="summary-row"><span>${esc(drugById(item.drugId)?.name)} · ${esc(item.number)} · ${item.qty} ${esc(drugById(item.drugId)?.smallUnit)}</span><strong>${rupiah(item.cost * item.qty)}</strong></div>`).join("") + `<div class="summary-row summary-total"><span>Total tagihan</span><strong>${rupiah(items.reduce((sum, item) => sum + item.cost * item.qty, 0))}</strong></div>`;
    document.getElementById("incoming-batch").value = "";
    document.getElementById("incoming-cost").value = "";
    document.getElementById("incoming-qty").value = "";
  });
}

function bindPageActions() {
  pageContainer.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "add-drug") showDrugModal();
    if (action === "add-batch") showBatchModal();
    if (action === "add-incoming") showIncomingModal();
    if (action === "drug-menu") showRowMenu(button, button.dataset.id, "drug");
    if (action === "batch-menu") showRowMenu(button, button.dataset.id, "batch");
    if (action === "export-stock") exportStock();
    if (action === "add-user") showUserModal();
    if (action === "toggle-user") {
      const active = button.dataset.active === "true";
      if (!window.confirm(`${active ? "Aktifkan" : "Nonaktifkan"} akun pengguna ini?`)) return;
      apiRequest(`/users/${encodeURIComponent(button.dataset.id)}/active`, { method: "PATCH", body: { active } })
        .then(() => renderUsers())
        .then(() => toast(`Akun berhasil ${active ? "diaktifkan" : "dinonaktifkan"}.`))
        .catch((error) => toast(error.message, true));
    }
    if (action === "ship-wholesale") {
      button.disabled = true;
      apiRequest(`/sales/${encodeURIComponent(button.dataset.id)}/warehouse`, { method: "PATCH", body: { status: "Selesai_Dikirim" } })
        .then(() => refreshState())
        .then(() => toast("Faktur ditandai selesai dikirim."))
        .catch((error) => toast(error.message, true))
        .finally(() => { if (button.isConnected) button.disabled = false; });
    }
  }));
}

function showRowMenu(button, id, type) {
  const previous = document.querySelector(".action-menu.open");
  previous?.remove();
  const menu = document.createElement("div");
  menu.className = "action-menu open";
  menu.innerHTML = type === "drug" ? `<button data-menu="edit">Edit obat</button><button data-menu="delete">Hapus obat</button>` : `<button data-menu="quarantine">Karantina ED</button><button data-menu="activate">Aktifkan batch</button>`;
  button.parentElement.style.position = "relative";
  button.parentElement.append(menu);
  menu.querySelectorAll("button").forEach((item) => item.addEventListener("click", async () => {
    if (type === "drug") {
      const drug = drugById(id);
      if (item.dataset.menu === "edit") showDrugModal(drug);
      else if (item.dataset.menu === "delete") {
        if (state.batches.some((batch) => batch.drugId === id && batch.stock > 0)) return toast("Obat masih memiliki stok. Habiskan stok sebelum menghapus.", true);
        if (!window.confirm(`Hapus obat ${drug.name} dari master?`)) return;
        try {
          await apiRequest(`/drugs/${encodeURIComponent(id)}`, { method: "DELETE" });
          await refreshState();
          toast("Obat berhasil dihapus.");
        } catch (error) {
          toast(error.message, true);
        }
      }
    } else {
      const batch = state.batches.find((entry) => String(entry.id) === String(id));
      if (!batch || batch.stock <= 0) return toast("Batch tanpa stok tidak dapat mengubah status.", true);
      const status = item.dataset.menu === "quarantine" ? "Karantina_ED" : "Aktif";
      if (status === "Aktif" && batch.expiry < dateInputValue()) return toast("Batch yang sudah kedaluwarsa tidak dapat diaktifkan.", true);
      try {
        await apiRequest(`/batches/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status } });
        await refreshState();
        toast("Status batch berhasil diperbarui.");
      } catch (error) {
        toast(error.message, true);
      }
    }
  }));
  window.setTimeout(() => document.addEventListener("click", function closeMenu(event) {
    if (!menu.contains(event.target) && event.target !== button) { menu.remove(); document.removeEventListener("click", closeMenu); }
  }, { once: true }), 0);
}

function exportStock() {
  const headers = ["waktu", "obat", "no_batch", "jenis_mutasi", "referensi", "qty_masuk", "qty_keluar", "sisa_stok"];
  const rows = state.logs.map((log) => {
    const batch = state.batches.find((entry) => entry.id === log.batchId);
    const drug = batch && drugById(batch.drugId);
    return [log.date, drug?.name || "", batch?.number || "", log.type, log.reference, log.in, log.out, log.balance];
  });
  const csv = [headers, ...rows].map((row) => row.map((value) => {
    const text = String(value);
    const safeText = typeof value === "string" && /^[=+\-@]/.test(text.trim()) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  }).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kartu-stok-${dateInputValue()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Laporan kartu stok berhasil diekspor.");
}

function bindNavigationButtons() {
  pageContainer.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.go)));
}

document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
document.getElementById("mobile-menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = document.getElementById("login-error");
  const submitButton = document.getElementById("login-submit");
  errorBox.classList.remove("visible");
  submitButton.disabled = true;
  try {
    const result = await apiRequest("/login", {
      method: "POST",
      body: { email: document.getElementById("login-email").value, password: document.getElementById("login-password").value },
    });
    showApplication(result.user, result.csrfToken);
    await refreshState();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.add("visible");
  } finally {
    submitButton.disabled = false;
  }
});
document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await apiRequest("/logout", { method: "POST" });
  } catch (error) {
    toast(error.message, true);
  } finally {
    showLogin();
  }
});
document.getElementById("password-button").addEventListener("click", showPasswordModal);

async function initialize() {
  try {
    const session = await apiRequest("/me");
    showApplication(session.user, session.csrfToken);
    await refreshState();
  } catch (error) {
    if (error.message.includes("Database tidak tersedia")) {
      document.getElementById("login-error").textContent = error.message;
      document.getElementById("login-error").classList.add("visible");
    }
    showLogin();
  }
}

initialize();
