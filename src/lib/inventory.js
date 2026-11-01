const EPSILON = 0.000001;

function amount(value, field) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a finite non-negative number`);
  return n;
}

function measures(value = {}) {
  const kg = amount(value.kg, 'kg');
  const cases = amount(value.cases, 'cases');
  if (!Number.isInteger(cases)) throw new Error('ケース数は整数で入力してください');
  if (!(kg > 0)) throw new Error('重量は0より大きくしてください');
  return { kg, cases };
}

function balance(value = {}) {
  const result = {
    onHandKg: amount(value.onHandKg, 'onHandKg'),
    reservedKg: amount(value.reservedKg, 'reservedKg'),
    onHandCases: amount(value.onHandCases, 'onHandCases'),
    reservedCases: amount(value.reservedCases, 'reservedCases'),
  };
  if (result.reservedKg - result.onHandKg > EPSILON || result.reservedCases > result.onHandCases) {
    throw new Error('予約数量が現在庫を超えています');
  }
  return result;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function reserveMeasures(current, request) {
  const b = balance(current);
  const q = measures(request);
  const availableKg = rounded(b.onHandKg - b.reservedKg);
  const availableCases = b.onHandCases - b.reservedCases;
  if (q.kg - availableKg > EPSILON || q.cases > availableCases) {
    throw new Error('在庫が不足しています。重量とケース数を確認してください');
  }
  return { ...b, reservedKg: rounded(b.reservedKg + q.kg), reservedCases: b.reservedCases + q.cases };
}

export function releaseMeasures(current, request) {
  const b = balance(current);
  const q = measures(request);
  if (q.kg - b.reservedKg > EPSILON || q.cases > b.reservedCases) {
    throw new Error('予約数量を超えて解放できません');
  }
  return { ...b, reservedKg: rounded(b.reservedKg - q.kg), reservedCases: b.reservedCases - q.cases };
}

export function shipMeasures(current, request) {
  const b = balance(current);
  const q = measures(request);
  if (q.kg - b.reservedKg > EPSILON || q.cases > b.reservedCases) {
    throw new Error('予約数量を超えて出庫できません');
  }
  return {
    onHandKg: rounded(b.onHandKg - q.kg),
    reservedKg: rounded(b.reservedKg - q.kg),
    onHandCases: b.onHandCases - q.cases,
    reservedCases: b.reservedCases - q.cases,
  };
}
