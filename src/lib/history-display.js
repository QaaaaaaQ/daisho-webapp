import { calcTax } from './money.js';

// Read-only display. Issuing, exporting, saving and posting stock stay strict.
const finiteAmount = value => {
  if (value == null || value === '' || typeof value === 'boolean' || typeof value === 'object') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : null;
};
const validSnapshot = value => value?.version === 2 &&
  ['total','sub','tax','s8','s10','t8','t10','gross8','gross10'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0) &&
  value.total === value.sub + value.tax && value.total === value.gross8 + value.gross10 &&
  value.gross8 === value.s8 + value.t8 && value.gross10 === value.s10 + value.t10;

export function historyDocumentView(doc = {}) {
  const raw = doc?.items;
  const items = Array.isArray(raw) ? raw.filter(i => i && typeof i === 'object' && !Array.isArray(i)) : [];
  let issue = '';
  let calculated = null;
  try {
    if (raw != null && !Array.isArray(raw)) throw new Error('Invalid item list');
    if (Array.isArray(raw) && items.length !== raw.length) throw new Error('Invalid item row');
    // Do not use validItems here: it converts historical unknown rates to 8%.
    calculated = calcTax(items);
  } catch (error) {
    issue = error.message === 'Unsupported tax rate'
      ? '\u660e\u7d30\u306e\u7a0e\u7387\u304c8%\u30fb10%\u4ee5\u5916\u3067\u3059\u3002\u539f\u7968\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
      : '\u65e7\u660e\u7d30\u306e\u5f62\u5f0f\u30fb\u91d1\u984d\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002';
  }
  const snapshot = validSnapshot(doc?.taxSummary) ? doc.taxSummary : null;
  if (doc?.taxSummary?.version === 2 && !snapshot) {
    issue ||= '\u4fdd\u5b58\u6e08\u307f\u306e\u7a0e\u984d\u5185\u8a33\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002';
  }
  const stored = finiteAmount(doc?.amount);
  const receipt = doc?.docType === '\u9818\u53ce\u66f8';
  const tx = snapshot || (!issue && items.length ? calculated : null);
  const total = receipt && stored > 0 ? stored : tx?.total ?? stored;
  const tax = !issue && tx && (!receipt || total === tx.total) ? tx.tax : null;
  return {items, issue, total, tax,
    source: receipt && stored > 0 ? 'stored' : snapshot ? 'snapshot' : tx ? 'calculated' : stored != null ? 'stored' : 'unknown',
    label: issue ? '\u7a0e\u533a\u5206\u30fb\u91d1\u984d\u8981\u78ba\u8a8d' : tax == null ? '\u7a0e\u984d\u672a\u8a18\u8f09' : ''};
}
