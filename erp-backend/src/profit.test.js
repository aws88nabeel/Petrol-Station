import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLine, computeSale, round4 } from './profit.js';

test('computeLine: DIESEL 27282L @ 0.250650 incl with 5 baisa profit', () => {
  const c = computeLine(27282, 0.250650, 5);
  assert.equal(c.lineTotalIncl, round4(27282 * 0.250650));
  assert.equal(c.profitOmr, 136.41);
  // VAT 5%: excl = incl/1.05
  assert.equal(round4(c.lineTotalIncl / 1.05), c.lineTotalExcl);
  assert.ok(Math.abs(c.lineVat - (c.lineTotalIncl - c.lineTotalExcl)) < 0.001);
});

test('computeLine: proper VAT split (5% standard)', () => {
  const c = computeLine(100, 1.05, 7);
  assert.equal(c.lineTotalIncl, 105);
  assert.equal(c.lineTotalExcl, 100);
  assert.equal(c.lineVat, 5);
});

test('computeSale: default profit rule used when no override', () => {
  const r = computeSale([
    { qtyLitres: 27282, unitPriceIncl: 0.250650, defaultProfitBaisa: 5 },
    { qtyLitres: 9080, unitPriceIncl: 0.231650, defaultProfitBaisa: 5 },
  ]);
  assert.equal(r.totalProfitOmr, 181.81);
  assert.equal(r.lines[0].overridden, false);
});

test('computeSale: manual override takes precedence and flags override', () => {
  const r = computeSale([
    { qtyLitres: 1000, unitPriceIncl: 1.0, defaultProfitBaisa: 5, overrideProfit: 7, overrideReason: 'test' },
  ]);
  assert.equal(r.lines[0].profitBaisa, 7);
  assert.equal(r.lines[0].overridden, true);
  assert.equal(r.totalProfitOmr, 7); // 1000 * 7 / 1000
});

test('computeSale: profit for Ejaba+ (5) vs Basma+ (7)', () => {
  const ejaba = computeSale([{ qtyLitres: 1000, unitPriceIncl: 1.0, defaultProfitBaisa: 5 }]);
  const basma = computeSale([{ qtyLitres: 1000, unitPriceIncl: 1.0, defaultProfitBaisa: 7 }]);
  assert.equal(ejaba.totalProfitOmr, 5);
  assert.equal(basma.totalProfitOmr, 7);
});
