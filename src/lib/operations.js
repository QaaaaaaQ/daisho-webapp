import { calcTax } from './money.js';
const roundKg = value => Math.round(Number(value) * 1_000_000) / 1_000_000;

export function taxCorrectionPreview(document, itemRates) {
  if (!document?.id || !Array.isArray(document.items) || !Array.isArray(itemRates) || itemRates.length !== document.items.length) {
    throw new Error('書類と明細の税率を確認してください');
  }
  const changes = document.items.flatMap((item, index) => {
    const from = Number(item.taxRate);
    const to = Number(itemRates[index]);
    if (![8, 10].includes(to)) throw new Error('税率は8%または10%から選択してください');
    return from === to ? [] : [{ index, name: item.name, from, to, amount: Number(item.amount || 0) }];
  });
  if (!changes.length) throw new Error('修正する明細がありません');
  const items=document.items.map((item,index)=>({...item,taxRate:Number(itemRates[index])}));
  return { documentId: document.id, docNo: document.docNo, expectedUpdatedAt: document.updatedAt, changes, summary:calcTax(items) };
}

export function confirmLegacyPdfAmounts(document, { gross, tax, rates }, confirmed) {
  const amount = Number(gross);
  const taxAmount = Number(tax);
  if (!Array.isArray(rates) || rates.length !== document.items?.length || rates.some(rate=>![8,10].includes(Number(rate)))) throw new Error('原票に記載された各明細の税率を確認してください');
  const items=document.items.map((item,index)=>({...item,taxRate:Number(rates[index])}));
  const summary=calcTax(items);
  if (!confirmed || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(taxAmount) || taxAmount < 0 || taxAmount > amount || Math.abs(amount-summary.total)>0.01 || Math.abs(taxAmount-summary.tax)>0.01) {
    throw new Error('原票で合計金額と消費税を確認してください');
  }
  return { ...document, items, amount, taxSummary: { version: 2, ...summary } };
}

export function inventoryLineMeasures(item) {
  const kg = Number(item?.qty || 0);
  const cases = Number(item?.caseCount || 0);
  if (!Number.isFinite(kg) || kg <= 0 || !Number.isInteger(cases) || cases < 0) throw new Error('箱数とkg実重量を確認してください');
  return { kg: roundKg(kg), cases };
}

export function isAdminRole(role) { return role === 'admin'; }
