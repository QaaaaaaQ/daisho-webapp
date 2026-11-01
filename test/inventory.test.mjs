import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveMeasures, releaseMeasures, shipMeasures } from '../src/lib/inventory.js';

const starting = { onHandKg: 120, reservedKg: 25, onHandCases: 8, reservedCases: 2 };

test('box count and measured kilograms stay independent for variable-weight goods', () => {
  const result = reserveMeasures(starting, { kg: 31.5, cases: 2 });
  assert.deepEqual(result, { ...starting, reservedKg: 56.5, reservedCases: 4 });
});

test('reservation rejects a request that exceeds available kilograms or cases', () => {
  assert.throws(() => reserveMeasures(starting, { kg: 96, cases: 1 }), /在庫が不足/);
  assert.throws(() => reserveMeasures(starting, { kg: 10, cases: 7 }), /在庫が不足/);
});

test('cancellation releases reserved quantities without changing on-hand stock', () => {
  const result = releaseMeasures({ ...starting, reservedKg: 40, reservedCases: 3 }, { kg: 15, cases: 1 });
  assert.deepEqual(result, { ...starting, reservedKg: 25, reservedCases: 2 });
});

test('shipment consumes both on-hand and reserved quantities exactly once', () => {
  const result = shipMeasures({ ...starting, reservedKg: 40, reservedCases: 3 }, { kg: 15, cases: 1 });
  assert.deepEqual(result, { onHandKg: 105, reservedKg: 25, onHandCases: 7, reservedCases: 2 });
});

test('release and shipment cannot consume more than the active reservation', () => {
  assert.throws(() => releaseMeasures(starting, { kg: 26, cases: 1 }), /予約数量を超え/);
  assert.throws(() => shipMeasures(starting, { kg: 26, cases: 1 }), /予約数量を超え/);
});
