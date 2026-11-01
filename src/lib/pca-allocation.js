import { calcTax } from './money.js';

function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((weight, index) => {
    const exact = sum ? total * weight / sum : 0;
    const value = Math.floor(exact);
    return { index, value, remainder: exact - value };
  });
  let remaining = total - parts.reduce((a, p) => a + p.value, 0);
  for (const part of [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining-- <= 0) break;
    part.value++;
  }
  return parts.map(part => part.value);
}

export function allocatePcaTax(rows) {
  for (const rate of [8, 10]) {
    const group = rows.filter(row => row.rate === rate);
    if (!group.length) continue;
    const summary = calcTax(group.map(row => ({ amount: row.originalAmount, taxRate: rate, taxIncluded: row.included })));
    const gross = distribute(summary['gross' + rate], group.map(row => row.originalAmount * (row.included ? 1 : 1 + rate / 100)));
    const tax = distribute(summary['t' + rate], gross);
    group.forEach((row, index) => { row.gross = gross[index]; row.tax = tax[index]; });
  }
}
