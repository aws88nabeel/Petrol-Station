// Profit calculation helpers.
// Profit rules are fully dynamic and configured per station by admins (no hardcoded defaults).
// Formula: line_profit_OMR = (qty_litres * profit_baisa) / 1000

export const VAT_RATE = 5.0; // Oman standard VAT %

export function vatMultiplier(rate = VAT_RATE) {
  return 1 + rate / 100;
}

/**
 * Compute derived monetary fields for a sale line.
 * @param {number} qtyLitres
 * @param {number} unitPriceInclVat
 * @param {number} profitBaisa
 * @param {number} vatRate
 */
export function computeLine(qtyLitres, unitPriceInclVat, profitBaisa, vatRate = VAT_RATE) {
  const lineTotalIncl = round4(qtyLitres * unitPriceInclVat);
  const lineTotalExcl = round4(lineTotalIncl / vatMultiplier(vatRate));
  const lineVat = round4(lineTotalIncl - lineTotalExcl);
  const profitOmr = round4((qtyLitres * profitBaisa) / 1000);
  const unitPriceExcl = round6(unitPriceInclVat / vatMultiplier(vatRate));
  return { lineTotalIncl, lineTotalExcl, lineVat, profitOmr, unitPriceExcl };
}

export function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
export function round6(n) {
  return Math.round((n + Number.EPSILON) * 1000000) / 1000000;
}

/**
 * Pseudocode reference — pure function returning computed lines and totals.
 * This is the auditable core used by both the API and unit tests.
 */
export function computeSale(lines, vatRate = VAT_RATE) {
  let totalLitres = 0;
  let subtotalExcl = 0;
  let vatAmount = 0;
  let totalIncl = 0;
  let totalProfit = 0;

  const computed = lines.map((l, i) => {
    const profit = l.overrideProfit !== undefined && l.overrideProfit !== null
      ? l.overrideProfit
      : l.defaultProfitBaisa;
    const overridden = l.overrideProfit !== undefined && l.overrideProfit !== null;
    const c = computeLine(l.qtyLitres, l.unitPriceIncl, profit, vatRate);
    totalLitres += l.qtyLitres;
    subtotalExcl += c.lineTotalExcl;
    vatAmount += c.lineVat;
    totalIncl += c.lineTotalIncl;
    totalProfit += c.profitOmr;
    return { ...l, index: i, ...c, profitBaisa: profit, overridden };
  });

  return {
    lines: computed,
    totalLitres,
    subtotalExclVat: round4(subtotalExcl),
    vatAmount: round4(vatAmount),
    totalInclVat: round4(totalIncl),
    totalProfitOmr: round4(totalProfit),
  };
}
