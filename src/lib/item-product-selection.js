// Never silently pick one of several products with the same name.
export function itemProductSelection(item, products = []) {
  if (item.productId && products.some(p => p.id === item.productId)) return item.productId;
  const name = String(item.name || '').trim();
  if (!name) return '';
  if (item.productId) return '__draft_name__';
  const matches = products.filter(p => !p.archivedAt && String(p.name || '').trim() === name);
  return matches.length === 1 ? matches[0].id : '__draft_name__';
}
