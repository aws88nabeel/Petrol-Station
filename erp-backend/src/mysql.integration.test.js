// MySQL/MariaDB integration test — exercises the FULL mysql adapter against a
// real server. Skipped (with a note) unless MYSQL_TEST=1 and DB_TYPE=mysql are
// set. Intended to run against the docker-compose MariaDB or a staging database.
//
//   docker compose up -d
//   DB_TYPE=mysql DB_HOST=127.0.0.1 DB_USER=erp DB_PASSWORD=erp123 DB_NAME=erp MYSQL_TEST=1 npm run test:mysql
import { test } from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.MYSQL_TEST === '1';

test('mysql adapter boot + full roundtrip', { skip: !enabled && 'MYSQL_TEST not set — run with docker-compose MariaDB and MYSQL_TEST=1' }, async () => {
  if (!enabled) return;
  const started = Date.now();
  const { default: service } = await import('./services.js');
  const db = (await import('./db.js')).default;

  const cat = await service.getCatalog();
  assert.ok(cat.products.length >= 3, 'products seeded');
  assert.ok(cat.paymentMethods.length >= 3, 'payment methods seeded');

  const product = cat.products.find((p) => p.default_unit_cost != null) || cat.products[0];
  const method = cat.paymentMethods[0];

  // Profit rules are fully dynamic: ensure an active rule exists for the test pair.
  let rule = await service.getDefaultProfit(product.product_id, method.method_id);
  let createdRule = false;
  if (!rule) {
    rule = await service.createProfitRule({
      productId: product.product_id,
      methodId: method.method_id,
      defaultProfitBaisa: 5,
    }, 'mysql integration test setup', 1);
    createdRule = true;
  }

  // Sales validate stock availability, so add stock before creating the sale.
  await service.stockReceipt({
    siteId: 1,
    productId: product.product_id,
    qtyLitres: 100,
    unitCost: product.default_unit_cost,
    referenceNo: 'MYSQL-TEST',
    movementDate: '2026-09-12',
    notes: 'mysql integration test setup',
  }, 1);

  let saleId;
  try {
    const created = await service.createSale({
      siteId: 1,
      saleDate: '2026-09-12',
      saleDatetime: '2026-09-12 08:00:00',
      paymentMethodId: method.method_id,
      notes: 'mysql integration test',
      lines: [{ productId: product.product_id, qtyLitres: 5, unitPriceIncl: 0.26 }],
    }, 1);
    saleId = created.sale_id;
    assert.equal(created.status, 'COMPLETED');
    assert.equal(created.lines.length, 1);

    const reloaded = await service.getSale(saleId);
    assert.equal(reloaded.sale_id, saleId);

    const voided = await service.voidSale(saleId, 1, 'integration test cleanup');
    assert.equal(voided.status, 'VOIDED');

    const summary = await service.summaryByMethod({ fromDate: '2026-09-01', toDate: '2026-09-30' });
    assert.ok(Array.isArray(summary));
  } finally {
    if (saleId) {
      await db.run('DELETE FROM sale_profit_audit WHERE sale_id = ?', [saleId]);
      await db.run('DELETE FROM stock_movements WHERE reference_no = (SELECT sale_number FROM sales WHERE sale_id = ?)', [saleId]);
      await db.run('DELETE FROM sale_lines WHERE sale_id = ?', [saleId]);
      await db.run('DELETE FROM sales WHERE sale_id = ?', [saleId]);
    }
    await db.run("DELETE FROM stock_movements WHERE reference_no = 'MYSQL-TEST'");
    if (createdRule) await service.deleteProfitRule(rule.rule_id, 'mysql integration test cleanup', 1);
  }

  console.log(`mysql roundtrip ok (${Date.now() - started}ms, sale->get->void, summary, cleanup)`);
});
