// Only spellings that denote the same kilogram unit are interchangeable.
const kgSpellings=new Set(['kg','キロ','キログラム']);
const isKg=value=>kgSpellings.has(String(value??'').normalize('NFKC').trim().toLowerCase());

export function alignUnitsWithMaster(doc,products=[]) {
  if(!Array.isArray(doc?.items))return doc;
  let changed=false;
  const items=doc.items.map(item=>{
    if(!item||!isKg(item.unit))return item;
    const matches=item.productId
      ? products.filter(p=>p.id===item.productId)
      : products.filter(p=>!p.archivedAt&&String(p.name||'').trim()===String(item.name||'').trim());
    if(matches.length!==1||!isKg(matches[0].unit)||item.unit===matches[0].unit)return item;
    changed=true;
    return {...item,unit:matches[0].unit};
  });
  return changed?{...doc,items}:doc;
}
