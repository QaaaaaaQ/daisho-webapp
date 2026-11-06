import test from 'node:test';
import assert from 'node:assert/strict';
import { itemProductSelection } from '../src/lib/item-product-selection.js';

test('draft names stay visible when products are missing or ambiguous', () => {
  const products = [{id:'1',name:'刺身'}, {id:'2',name:'刺身'}];
  assert.equal(itemProductSelection({name:'寿司ネタ'}, products), '__draft_name__');
  assert.equal(itemProductSelection({name:'刺身'}, products), '__draft_name__');
  assert.equal(itemProductSelection({name:'刺身', productId:'2'}, products), '2');
  assert.equal(itemProductSelection({name:'刺身', productId:'gone'}, products), '__draft_name__');
  assert.equal(itemProductSelection({name:'刺身'}, products.slice(0,1)), '1');
  assert.equal(itemProductSelection({}, products), '');
});
