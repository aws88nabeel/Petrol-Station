// PDF report generation for Oman-style sales & profit reporting.
// Pure pdfkit (no native dependencies). Produces:
//   1. generateInvoicePDF(sale)  -> a single fiscal-worthy sales invoice
//   2. generateSummaryPDF(range) -> a sales & profit summary report
import PDFDocument from 'pdfkit';
import db from './db.js';

const VAT_RATE = 5.0;

const fmt = (n, d = 3) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function getSite() {
  return (await db.get('SELECT * FROM sites WHERE is_active = 1 ORDER BY site_id LIMIT 1')) || {};
}

function stationHeader(doc, site) {
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0b3d2e')
    .text(site.site_name || 'FUEL STATION', doc.page.margins.left, doc.page.margins.top + 20);
  doc.fontSize(9).font('Helvetica').fillColor('#333');
  const sub = [site.vat_reg_no ? `VAT Reg. No.: ${site.vat_reg_no}` : null, site.tin ? `CR/TIN: ${site.tin}` : null]
    .filter(Boolean).join('  |  ');
  doc.text(sub, { continued: false, lineGap: 2 });
  doc.fontSize(9).fillColor('#555').text(`${site.address || ''}`, { lineGap: 2 });
  doc.moveDown(0.4);
  // separator line
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .lineWidth(1.2).strokeColor('#0b3d2e').stroke();
  doc.moveDown(0.6);
  return w;
}

// TSS (Tax Security Stamp) placeholder — a real QR would embed a signed
// sAuth request payload from the Oman tax authority. Here we draw the
// invoice details into a QR-like block area labelled as the fiscal stamp.
function tssPlaceholder(doc, data) {
  const s = 72; // 72pt ≈ 25.4mm — Oman TSS QR size is 25mm
  const x = doc.page.width - doc.page.margins.right - s;
  const y = doc.y;
  doc.save().rotate(0);
  // box
  doc.rect(x, y, s, s).lineWidth(1).strokeColor('#000').stroke();
  // simple pseudo-QR grid so it visualises as a stamp
  const cells = 6, cs = s / cells;
  doc.fillColor('#000');
  const block = [1.2, 2.2, 3.3, 4.1]; // pseudo-pattern indexes
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if ((i + j) % (block[(i * cells + j) % block.length] >= 1 ? 2 : 3) === 0 && (i % 2) === 0) {
        doc.rect(x + j * cs, y + i * cs, cs, cs).fill();
      }
    }
  }
  doc.restore();
  doc.fontSize(6).font('Helvetica').fillColor('#000')
    .text('TSS', x, y + s + 2, { width: s, align: 'center' });
  return y + s + 14;
}

// Approximate character width for Helvetica at a given font size — used to
// size columns so titles and values fit without clipping.
function textW(text, size) {
  return (String(text || '').length + 1) * size * 0.5;
}

// Column layout for a table. Columns are sized to fit the wider of the title
// or the longest cell (at the given header/body font sizes), sharing the
// available page width proportionally by content. A column's width can be
// capped with opts.max[i] so long free-text cells (e.g. Notes) wrap and don't
// squeeze the numeric columns.
function colLayout(headers, rows, opts = {}) {
  const w = opts.width || (docPageWidth() - 80);
  const headFont = opts.headSize || 9;
  const bodyFont = opts.bodySize || 8.5;
  const min = opts.min || 28;
  const pad = opts.pad || 8;
  const req = headers.map((h, i) => {
    let need = textW(h, headFont);
    rows.forEach((r) => { need = Math.max(need, textW(r[i], bodyFont)); });
    let col = need + pad;
    if (opts.max && opts.max[i]) col = Math.min(col, opts.max[i]);
    return Math.max(min, col);
  });
  const total = req.reduce((a, b) => a + b, 0);
  const cw = req.map((n) => Math.floor((n / total) * w));
  // nudge last column to absorb rounding so the table spans the page
  const used = cw.reduce((a, b) => a + b, 0);
  cw[cw.length - 1] += w - used;
  return cw;
}

let _pageWidthCache = 595.28; // A4 width pt
function docPageWidth() { return _pageWidthCache; }

function lineTable(doc, headers, rows, opts = {}) {
  _pageWidthCache = doc.page.width;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  // Size columns to the actual table width (margins may differ from the default
  // 40pt used by colLayout), otherwise wide layouts overflow the last column.
  const cw = opts.colWidths || colLayout(headers, rows, { ...opts, width: w });
  const x0 = doc.page.margins.left;
  let y = doc.y;

  const aligns = opts.aligns || headers.map(() => 'left');
  const headSize = opts.headSize || 9;
  const bodySize = opts.bodySize || 8.5;
  const headBg = opts.headBg || '#eef2ea';
  const headColor = opts.headColor || '#0b3d2e';
  const grid = !!opts.grid;
  const gridColor = opts.gridColor || '#b9c4d4';

  const strokeGrid = (rowY, rowH) => {
    doc.save().lineWidth(0.6).strokeColor(gridColor);
    doc.rect(x0, rowY, w, rowH).stroke();
    let gx = x0;
    for (let i = 0; i < cw.length - 1; i++) {
      gx += cw[i];
      doc.moveTo(gx, rowY).lineTo(gx, rowY + rowH).stroke();
    }
    doc.restore();
  };

  const drawHeader = () => {
    doc.fontSize(headSize).font('Helvetica-Bold').fillColor(headColor);
    doc.rect(x0, y, w, 18).fill(headBg);
    if (grid) strokeGrid(y, 18);
    let cx = x0;
    headers.forEach((h, i) => {
      doc.fillColor(headColor).text(h, cx + 4, y + 5, { width: cw[i] - 8, align: aligns[i] });
      cx += cw[i];
    });
    y += 18;
  };

  drawHeader();

  doc.font('Helvetica').fontSize(bodySize).fillColor('#111');
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 20;
  rows.forEach((r) => {
    const lineH = bodySize * 1.2;
    let rh = 16;
    let cx = x0;
    r.forEach((cell, i) => {
      doc.font('Helvetica').fontSize(bodySize);
      const text = String(cell === null || cell === undefined ? '' : cell);
      const availW = cw[i] - 6;
      const lines = Math.max(1, Math.ceil(doc.widthOfString(text, { lineBreak: false }) / availW));
      rh = Math.max(rh, 6 + lines * lineH);
    });
    if (opts.pageBreak && y + rh + 2 > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    doc.rect(x0, y, w, rh + 2).fill(r._tot ? '#0b3d2e' : (r._alt ? '#f6f8f4' : '#ffffff'));
    if (grid) strokeGrid(y, rh + 2);
    cx = x0;
    r.forEach((cell, i) => {
      const text = String(cell === null || cell === undefined ? '' : cell);
      doc.font(r._tot ? 'Helvetica-Bold' : 'Helvetica').fillColor(r._tot ? '#ffffff' : '#111');
      doc.text(text, cx + 4, y + 4, { width: cw[i] - 8, align: aligns[i] });
      cx += cw[i];
    });
    y += rh + 2;
  });
  doc.y = y + 8;
}

async function invoicePDF(sale) {
  const site = await getSite();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    stationHeader(doc, site);

    // Title + meta
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0b3d2e').text('SALES INVOICE');
    doc.moveDown(0.3);

    const meta = [
      `Invoice No: ${sale.sale_number}`,
      `Date: ${sale.sale_datetime || sale.sale_date}`,
      `Shift: ${sale.shift_no || '—'}`,
      `Payment: ${sale.method_name || ''} ${sale.payment_ref ? '(' + sale.payment_ref + ')' : ''}`,
      `Status: ${sale.status}`,
    ];
    meta.forEach((m) => { doc.font('Helvetica').fontSize(9).fillColor('#333').text(m); });
    if (sale.notes) { doc.moveDown(0.2); doc.font('Helvetica').fontSize(9).fillColor('#666').text(`Notes: ${sale.notes}`); }
    doc.moveDown(0.8);

    // Line items
    const headers = ['#', 'Product', 'Qty (L)', 'Unit price (excl)', 'Amount excl VAT', 'VAT', 'Amount incl VAT'];
    const rows = sale.lines.map((l, i) => {
      const qty = l.quantity_litres;
      const excl = l.line_total_excl;
      const vat = l.line_total_vat;
      const incl = l.line_total_incl;
      return [i + 1, sale.productMap[l.product_id] || `Product ${l.product_id}`, fmt(qty, 3), fmt(l.unit_price_excl, 6), fmt(excl, 6), fmt(vat, 6), fmt(incl, 6)];
    });
    lineTable(doc, headers, rows, { aligns: ['left', 'left', 'right', 'right', 'right', 'right', 'right'] });

    // Totals
    doc.moveDown(0.5);
    const totals = [
['Subtotal (excl VAT)', fmt(sale.subtotal_excl_vat, 6)],
      [`VAT @ ${VAT_RATE}%`, fmt(sale.vat_amount, 6)],
      ['Total (incl VAT)', fmt(sale.total_incl_vat, 6)],
      ['Total profit', fmt(sale.total_profit_omr, 6)],
      ['NET AMOUNT (OMR)', fmt(sale.net_amount, 6)],
    ];
    const tx = doc.page.margins.left;
    let ty = doc.y;
    totals.forEach(([k, v], idx) => {
      doc.font(idx === totals.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#111')
        .text(k, tx + 250, ty, { width: 150, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(idx === totals.length - 1 ? 11 : 9).fillColor(idx === totals.length - 1 ? '#0b3d2e' : '#111')
        .text('OMR ' + v, tx + 410, ty, { width: 130, align: 'right' });
      ty += 16;
    });
    doc.y = ty + 8;

    // TSS stamp
    tssPlaceholder(doc, { invoice_no: sale.sale_number, total: sale.total_incl_vat });

    doc.moveDown(1);
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text('This is a computer-generated invoice. Goods once sold are not returnable. Prices are inclusive of VAT where stated.', { lineGap: 2 });
    doc.end();
  });
}

async function summaryPDF({ fromDate, toDate, daily, profit }) {
  const site = await getSite();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    stationHeader(doc, site);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0b3d2e').text('SALES & PROFIT REPORT');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#333').text(`Period: ${fromDate}  →  ${toDate}`);
    doc.moveDown(0.8);

    // Summary by payment method
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0b3d2e').text('Sales summary by payment method');
    doc.moveDown(0.3);
    const headers = ['Payment method', 'Sales', 'Litres', 'Excl VAT', 'VAT', 'Total', 'Profit'];
    const rows = daily.map((r) => [
      r.method_name, r.sale_count, fmt(r.total_litres, 3), fmt(r.total_excl, 6),
      fmt(r.total_vat, 6), fmt(r.total_incl, 6), fmt(r.total_profit, 6),
    ]);
    const tot = daily.reduce((a, r) => ({
      litres: a.litres + r.total_litres, excl: a.excl + r.total_excl,
      vat: a.vat + r.total_vat, incl: a.incl + r.total_incl, prof: a.prof + r.total_profit,
    }), { litres: 0, excl: 0, vat: 0, incl: 0, prof: 0 });
    rows.push(['TOTAL', daily.reduce((a, r) => a + r.sale_count, 0), fmt(tot.litres, 3), fmt(tot.excl, 6), fmt(tot.vat, 6), fmt(tot.incl, 6), fmt(tot.prof, 6)]);

    lineTable(doc, headers, rows, { aligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right'] });

    if (profit && profit.length) {
      doc.moveDown(0.6);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0b3d2e').text('Profit by product × payment method');
      doc.moveDown(0.3);
      const pHeaders = ['Product', 'Payment method', 'Litres', 'Avg profit (baisa/L)', 'Profit (OMR)', '# overrides'];
      const pRows = profit.map((r) => [
        r.product_name, r.method_name, fmt(r.total_litres, 3), r.avg_profit_baisa, fmt(r.total_profit_omr, 6), r.override_count > 0 ? r.override_count : 0,
      ]);
      lineTable(doc, pHeaders, pRows, { aligns: ['left', 'left', 'right', 'right', 'right', 'right'] });
    }

    doc.moveDown(1);
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text(`Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Muscat' })}  ·  Prepared by ${site.site_name || 'Fuel Station'}`);
    doc.end();
  });
}

// Stock movement ledger PDF. Rows come from service.stockLedgerReport with each
// movement carrying product_name, movement_type, quantity_litres, unit_cost,
// reference_no, movement_date and notes.
async function stockLedgerPDF({ fromDate, toDate, rows }) {
  const site = await getSite();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    stationHeader(doc, site);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0b3d2e').text('STOCK MOVEMENT LEDGER');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#333').text(`Period: ${fromDate || 'all dates'}  →  ${toDate || 'all dates'}`);
    doc.moveDown(0.8);

    const headers = ['Date', 'Product', 'Type', 'Qty (L)', 'Unit cost', 'Reference', 'Notes'];
    const aligns = ['left', 'left', 'left', 'right', 'right', 'left', 'left'];
    const data = (rows || []).map((r) => [
      r.movement_date, r.product_name, r.movement_type,
      (r.quantity_litres > 0 ? '+' : '') + fmt(r.quantity_litres, 3),
      r.unit_cost ? fmt(r.unit_cost, 6) : '—',
      r.reference_no || '—', r.notes || '',
    ]);

    // Fixed widths summing to the usable page width (~515pt) so each value sits
    // squarely under its column title; the Notes column is capped and wraps so
    // it never squeezes the numeric columns.
    const colWidths = [62, 70, 48, 70, 70, 110, 85];
    const max = [null, null, null, null, null, 110, 85];
    lineTable(doc, headers, data, { aligns, colWidths, max });

    if ((rows || []).length) {
      doc.moveDown(0.6);
      const inQ = rows.filter((r) => r.quantity_litres > 0).reduce((a, r) => a + r.quantity_litres, 0);
      const outQ = rows.filter((r) => r.quantity_litres < 0).reduce((a, r) => a - r.quantity_litres, 0);
      doc.font('Helvetica').fontSize(9).fillColor('#0b3d2e')
        .text(`Movements in range: ${rows.length}   ·   In (L): ${fmt(inQ, 3)}   ·   Out (L): ${fmt(outQ, 3)}   ·   Net (L): ${fmt(inQ - outQ, 3)}`);
    }

    doc.moveDown(1);
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text(`Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Muscat' })}  ·  Prepared by ${site.site_name || 'Fuel Station'}`);
    doc.end();
  });
}

// Stock entry report PDF (receipts and positive adjustments) with the 5% VAT
// split out. Rows come from service.stockEntriesReport and already carry
// quantity_litres, unit_cost, amount_excl_vat, vat_amount and amount_incl_vat.
async function stockEntriesPDF({ fromDate, toDate, report }) {
  const site = await getSite();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    stationHeader(doc, site);

    // Title block
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0b3d2e').text('STOCK ENTRIES · VAT REPORT');
    doc.moveDown(0.25);

    const period = `${fromDate || 'all dates'}  →  ${toDate || 'all dates'}`;
    const items = (report && report.items) || [];
    doc.font('Helvetica').fontSize(9).fillColor('#333').text(`Period: ${period}`);
    doc.font('Helvetica').fontSize(9).fillColor('#333').text(`Number of entries: ${items.length}`);
    doc.moveDown(0.3);

    // Legend
    const pretty = { RECEIPT: 'Receipt', ADJUSTMENT: 'Adjustment' };
    const headers = ['Date', 'Product', 'Tank', 'Type', 'Qty (L)', 'Unit cost', 'Excl VAT', 'VAT 5%', 'Incl VAT'];
    const aligns = ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right'];
    const tot = report || {};
    const data = items.map((r, i) => {
      const row = [
        r.movement_date, r.product_name, r.tank_name || '—', pretty[r.movement_type] || r.movement_type,
        fmt(r.quantity_litres, 3), r.unit_cost != null ? fmt(r.unit_cost, 6) : '—',
        fmt(r.amount_excl_vat, 6), fmt(r.vat_amount, 6), fmt(r.amount_incl_vat, 6),
      ];
      row._alt = i % 2 === 1;
      return row;
    });
    if (data.length) {
      const totalRow = [
        'TOTAL',
        '',
        '',
        '',
        fmt(tot.total_litres, 3),
        '',
        fmt(tot.total_excl, 6),
        fmt(tot.total_vat, 6),
        fmt(tot.total_incl, 6),
      ];
      totalRow._tot = true;
      data.push(totalRow);
    }
    // Landscape-friendly column caps: numeric columns keep right alignment and the
    // text columns get room to breathe; colLayout scales them to the full width.
    // Qty is intentionally narrow (values carry no unit suffix — the header does).
    const max = [92, 116, 106, 98, 62, 104, 104, 92, 104];

    lineTable(doc, headers, data, { aligns, max, pageBreak: true, headSize: 9.5, bodySize: 9, grid: true });

    if (items.length) {
      doc.moveDown(0.7);
      doc.rect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 68).fill('#f6f8f4').strokeColor('#d7dfec').lineWidth(0.8).stroke();
      const bx = doc.page.margins.left + 10;
      let by = doc.y + 8;
      const set = (label, value) => {
        doc.font('Helvetica').fontSize(9).fillColor('#333').text(label, bx, by, { width: 170, align: 'right' });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0b3d2e').text(value, bx + 182, by, { width: 160, align: 'right' });
        by += 15;
      };
      set('Total excl VAT', fmt(tot.total_excl, 6));
      set('VAT @ 5%', fmt(tot.total_vat, 6));
      set('Total incl VAT', fmt(tot.total_incl, 6));
      set('Total volume (L)', fmt(tot.total_litres, 3));
      doc.moveDown(2);
    } else {
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(9).fillColor('#666').text('No stock entries in the selected range.');
    }

    const note = `All amounts are in Omani Rial. Purchase unit cost is treated as VAT-inclusive; the VAT component is separated at the statutory rate of ${VAT_RATE}% (i.e. VAT = amount × ${VAT_RATE} ÷ ${100 + VAT_RATE}).`;
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8).fillColor('#666').text(note, { lineGap: 2 });

    doc.moveDown(1);
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text(`Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Muscat' })}  ·  Prepared by ${site.site_name || 'Fuel Station'}`);
    doc.end();
  });
}

export { invoicePDF, summaryPDF, stockLedgerPDF, stockEntriesPDF };