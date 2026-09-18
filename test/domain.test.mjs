import test from "node:test";
import assert from "node:assert/strict";
import { calcTax } from "../src/lib/pdf.js";
import { localDate, validateDocument, documentTotal } from "../src/lib/domain.js";

test("mixed tax-included and tax-excluded rows calculate the gross total", () => {
  const result = calcTax([
    { name: "外税", qty: 1, price: 100, amount: 100, taxRate: 8, taxIncluded: false },
    { name: "内税", qty: 1, price: 108, amount: 108, taxRate: 8, taxIncluded: true },
  ]);
  assert.equal(result.sub, 200);
  assert.equal(result.tax, 16);
  assert.equal(result.total, 216);
});

test("tax-included delivery total keeps 15,000 as the gross amount", () => {
  const result = calcTax([
    { name: "活アワビ", qty: 3, price: 5000, amount: 15000, taxRate: 8, taxIncluded: true },
  ]);
  assert.equal(result.sub, 13889);
  assert.equal(result.tax, 1111);
  assert.equal(result.total, 15000);
});

test("document validation rejects blank and negative stock rows", () => {
  assert.match(validateDocument({ docType: "納品書", customer: "顧客", date: localDate(), items: [{}] }), /明細/);
  assert.match(validateDocument({ docType: "納品書", customer: "顧客", date: localDate(), items: [{ name: "商品", qty: -1, price: 100, amount: -100 }] }), /数量/);
});

test("receipt can be issued with an amount and no item details", () => {
  assert.equal(validateDocument({ docType: "領収書", customer: "顧客", amount: 1000, items: [] }), "");
});

test("receipt display total prefers an explicit manual amount over detail total", () => {
  const items = [{ name: "商品A", qty: 1, price: 1100, amount: 1100, taxRate: 10, taxIncluded: true }];
  assert.equal(documentTotal({ docType: "領収書", amount: 7020, items }, calcTax(items).total), 7020);
  assert.equal(documentTotal({ docType: "領収書", amount: "", items }, calcTax(items).total), 1100);
  assert.equal(documentTotal({ docType: "領収書", amount: 7020, items: [] }, 0), 7020);
});
