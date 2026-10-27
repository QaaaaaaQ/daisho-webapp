// Monetary policy v2: group by rate, convert to gross, round half-up once per
// group, then derive that group's tax from its gross amount. No per-row tax sum.
// NTA: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm
const SCALE = 1000000n;
const roundRatio = (n, d) => (n + d / 2n) / d;
function units(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1000000000000) throw new Error('Invalid monetary amount');
  const [whole,fraction] = n.toFixed(6).split('.');
  return BigInt(whole)*SCALE + BigInt(fraction);
}
export function calcTax(items = []) {
  const groups = new Map([[8, 0n], [10, 0n]]);
  for (const item of items || []) {
    if (!item) continue;
    const rate = Number(item.taxRate ?? 8);
    if (rate !== 8 && rate !== 10) throw new Error('Unsupported tax rate');
    const amount = units(item.amount);
    groups.set(rate, groups.get(rate) + amount * BigInt(item.taxIncluded ? 100 : 100 + rate));
  }
  const out = {};
  for (const rate of [8, 10]) {
    const gross = roundRatio(groups.get(rate), SCALE * 100n);
    const tax = roundRatio(gross * BigInt(rate), BigInt(100 + rate));
    out['gross' + rate] = Number(gross);
    out['t' + rate] = Number(tax);
    out['s' + rate] = Number(gross - tax);
  }
  out.sub = out.s8 + out.s10;
  out.tax = out.t8 + out.t10;
  out.total = out.gross8 + out.gross10;
  return out;
}
export function receiptTax(doc) {
  const rows = (doc.items || []).filter(i => i && (i.name || Number(i.amount)));
  const tx = calcTax(rows);
  const amount = Number(doc.amount) > 0 ? Number(doc.amount) : tx.total;
  // An amount by itself does not establish a tax rate. Never invent 8%.
  return rows.length && Math.abs(amount - tx.total) < 0.01 ? tx.tax : null;
}
export function documentTax(doc) {
  return doc.taxSummary?.version === 2 ? doc.taxSummary : calcTax(doc.items || []);
}
