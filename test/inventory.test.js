const test = require("node:test");
const assert = require("node:assert/strict");
const { allocateFefo } = require("../lib/inventory");

test("alokasi ecer menggunakan batch ED terdekat lebih dahulu", () => {
  const batches = [
    { id_batch: 10, stok_tersedia: 3 },
    { id_batch: 11, stok_tersedia: 8 },
  ];

  assert.deepEqual(allocateFefo(batches, 5, 10, false), [
    { batchId: 10, retailUnits: 3, largeUnits: null },
    { batchId: 11, retailUnits: 2, largeUnits: null },
  ]);
});

test("alokasi grosir hanya menggunakan jumlah kemasan utuh per batch", () => {
  const batches = [
    { id_batch: 10, stok_tersedia: 19 },
    { id_batch: 11, stok_tersedia: 30 },
  ];

  assert.deepEqual(allocateFefo(batches, 3, 10, true), [
    { batchId: 10, retailUnits: 10, largeUnits: 1 },
    { batchId: 11, retailUnits: 20, largeUnits: 2 },
  ]);
});

test("grosir ditolak jika total stok ada tetapi tidak cukup kemasan utuh", () => {
  const batches = [
    { id_batch: 10, stok_tersedia: 9 },
    { id_batch: 11, stok_tersedia: 9 },
  ];

  assert.equal(allocateFefo(batches, 1, 10, true), null);
});
