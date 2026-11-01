import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPcaJournalCsv, eligiblePcaPayments } from '../src/lib/pca-journal.js';

const settings={pcaBankAccountCode:'111',pcaBankSubaccountCode:'01',pcaReceivableAccountCode:'120'};
const customers=[{name:'神戸大商',pcaSubaccountCode:'C001'}];
const payment={payment_date:'2026-11-01',payer:'株式会社, 神戸大商',amount:1200,reference:'INV-1',payment_allocations:[
  {amount:1200,documents:{doc_no:'INV-1',customer:'神戸大商'}}
]};
function parseCsvRow(line) {
  const values=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted&&ch==='"'&&line[i+1]==='"'){value+='"';i++;}
    else if(ch==='"')quoted=!quoted;
    else if(ch===','&&!quoted){values.push(value);value='';}
    else value+=ch;
  }
  values.push(value);return values;
}

test('PCA Version 7 journal has the 81-field layout and balanced cash/receivable lines',()=>{
  const csv=buildPcaJournalCsv([payment],customers,settings);
  const [version,row]=csv.trimEnd().split('\r\n');
  const fields=parseCsvRow(row);
  assert.equal(version,"text version='7'");
  assert.equal(fields.length,81);
  assert.equal(fields[0],'20261101');
  assert.equal(fields[7],'111');
  assert.equal(fields[9],'01');
  assert.equal(fields[13],'1200');
  assert.equal(fields[18],'120');
  assert.equal(fields[20],'C001');
  assert.equal(fields[24],'1200');
  assert.equal(fields[26],'株式会社, 神戸大商 / INV-1 / INV-1');
});

test('PCA export excludes unallocated or partially allocated receipts',()=>{
  assert.deepEqual(eligiblePcaPayments([
    payment,
    {...payment,amount:1300},
    {...payment,payment_allocations:[]},
  ]),[payment]);
  assert.throws(()=>buildPcaJournalCsv([{...payment,amount:1300}],customers,settings),/同額まで請求書に割り当て済み/);
});

test('PCA export requires valid account mappings and valid receipt amounts',()=>{
  assert.throws(()=>buildPcaJournalCsv([payment],customers,{}),/預金科目コード/);
  assert.throws(()=>buildPcaJournalCsv([{...payment,amount:1.5,payment_allocations:[{amount:1.5,documents:{}}]}],customers,settings),/整数/);
  assert.throws(()=>buildPcaJournalCsv([payment],[{name:'神戸大商',pcaSubaccountCode:'BAD CODE'}],settings),/補助コード/);
});
