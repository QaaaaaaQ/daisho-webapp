export const SALES_SUBACCOUNT_BY_CATEGORY = {
  'アサリ': '021',
  'アワビ': '005',
  'あんこう': '009',
  'うなぎ': '011',
  'サザエ': '002',
  'ふぐ類': '008',
  'ホタテ': '020',
  '蛤': '003',
  '蟹類': '016',
  '赤貝': '001',
};

export function normalizeName(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　]/g, '').trim();
}

function productCategoryKey(value) {
  return normalizeName(value)
    .replace(/[（(](?:一人前|\d+(?:[〜～-]\d+)?人前|生|ボイル|冷凍)[）)]/g, '')
    .replace(/(?:一人前|\d+(?:[〜～-]\d+)?人前)/g, '')
    .replace(/とらふく|とらふぐ|トラフグ|トラ河豚|虎河豚|真河豚|真ふぐ|まふぐ/g, '河豚')
    .replace(/刺身|さしみ|お造り|盛り合わせ|盛合せ|カット|ボイル|生|冷凍/g, '');
}

function categoryFromUniqueMasterMatches(matches) {
  if (!matches.length) return null;
  const category = matches[0].category;
  if (!category || !SALES_SUBACCOUNT_BY_CATEGORY[category] || matches.some(product => product.category !== category)) return null;
  return { category };
}

export function productForItem(item, products) {
  const linked = item.productId ? (products || []).find(product => product.id === item.productId) : null;
  if (linked) return linked;
  const name = normalizeName(item.name);
  const matches = (products || []).filter(product => normalizeName(product.name) === name);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return categoryFromUniqueMasterMatches(matches);

  const categoryKey = productCategoryKey(item.name);
  if (!categoryKey) return null;
  const variants = (products || []).filter(product => productCategoryKey(product.name) === categoryKey);
  return categoryFromUniqueMasterMatches(variants);
}

