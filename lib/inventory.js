function allocateFefo(batches, quantity, conversion, wholesale) {
  let remaining = quantity;
  const allocations = [];
  for (const batch of batches) {
    if (!remaining) break;
    const batchUnits = Number(batch.stok_tersedia);
    const batchCapacity = wholesale ? Math.floor(batchUnits / conversion) : batchUnits;
    const units = Math.min(remaining, batchCapacity);
    if (!units) continue;
    allocations.push({
      batchId: batch.id_batch,
      retailUnits: wholesale ? units * conversion : units,
      largeUnits: wholesale ? units : null,
    });
    remaining -= units;
  }
  return remaining === 0 ? allocations : null;
}

module.exports = { allocateFefo };
