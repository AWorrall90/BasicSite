import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../public/js/core.js';
import { levelFraction } from '../public/js/bottle.js';

const gin = { id: 'gin', name: "Gordon's Gin", category: 'Spirits', unit: 'bottle', sizeMl: 700, cost: 14, aliases: [] };
const lager = { id: 'lager', name: 'Peroni 330ml', category: 'Bottled beer & cider', unit: 'each', sizeMl: 330, cost: 1.1, aliases: ['Peroni Nastro Azzurro'] };

test('countTotal adds full units and open bottles', () => {
  assert.equal(core.countTotal({ full: 3, partials: [0.5, 0.25] }), 3.75);
  assert.equal(core.countTotal(undefined), 0);
  assert.equal(core.countTotal(2), 2);
});

test('parseCSV handles quotes, semicolons and BOM', () => {
  assert.deepEqual(core.parseCSV('﻿Item,Qty\n"Gin, Large",3\r\n"Say ""hi""",2\n'), [
    ['Item', 'Qty'], ['Gin, Large', '3'], ['Say "hi"', '2'],
  ]);
  assert.deepEqual(core.parseCSV('Item;Qty\nGin;4'), [['Item', 'Qty'], ['Gin', '4']]);
});

test('guessColumns finds the header row below a title block', () => {
  const rows = core.parseCSV('Sales report,,\nSite: The Crown,,\nPLU,Description,Qty Sold,Value\n1,Gin 25ml,12,£48.00\n2,Peroni,30,£150.00');
  assert.deepEqual(core.guessColumns(rows), { headerRow: 2, nameCol: 1, qtyCol: 2 });
});

test('salesLinesFromRows merges duplicates and skips totals', () => {
  const rows = [['Item', 'Qty'], ['Gin 25ml', '4'], ['Gin 25ml', '2'], ['Total', '6'], ['', '1']];
  assert.deepEqual(core.salesLinesFromRows(rows, { headerRow: 0, nameCol: 0, qtyCol: 1 }), [{ posName: 'Gin 25ml', sold: 6 }]);
});

test('resolveLine prefers remembered mappings, then fuzzy matches, and honours ignores', () => {
  const products = [gin, lager];
  assert.equal(core.resolveLine('GORDONS GIN 70CL', {}, products).productId, 'gin');
  assert.equal(core.resolveLine('Peroni Nastro Azzurro', {}, products).productId, 'lager');
  assert.equal(core.resolveLine('Gordons 25ml', {}, products, 0.6).productId, 'gin');
  const map = { 'house special': { productId: 'gin', unitsPerSale: 0.1 } };
  assert.deepEqual(core.resolveLine('House Special', map, products), { productId: 'gin', unitsPerSale: 0.1, source: 'remembered' });
  assert.equal(core.resolveLine('Chips', { chips: { productId: null } }, products).source, 'ignored');
  assert.equal(core.resolveLine('Chicken burger', {}, products), null);
});

test('defaultUnitsPerSale uses a 25ml measure for spirits', () => {
  assert.equal(core.defaultUnitsPerSale(gin), core.round(25 / 700, 4));
  assert.equal(core.defaultUnitsPerSale(lager), 1);
});

test('computeReport works out expected stock and variance', () => {
  const period = {
    opening: { counts: { gin: { full: 2, partials: [0.5] }, lager: { full: 24, partials: [] } } },
    deliveries: [{ lines: [{ productId: 'gin', qty: 1, packSize: 6 }, { productId: 'lager', qty: 2, packSize: 24 }] }],
    sales: [{ lines: [{ productId: 'gin', sold: 56, unitsPerSale: 25 / 700 }, { productId: 'lager', sold: 50, unitsPerSale: 1 }] }],
    closing: { counts: { gin: { full: 6, partials: [0.3] }, lager: { full: 20, partials: [] } } },
  };
  const { rows, totals } = core.computeReport(period, [gin, lager]);
  const g = rows.find((r) => r.productId === 'gin');
  assert.equal(g.expected, 6.5); // 2.5 + 6 - 2 bottles poured
  assert.equal(g.variance, 0.2);
  assert.equal(g.varianceValue, 2.8);
  const l = rows.find((r) => r.productId === 'lager');
  assert.equal(l.expected, 22);
  assert.equal(l.variance, 2);
  assert.equal(totals.varianceValue, 5);
  assert.match(core.reportToCSV({ rows, totals }), /^Product,Category/);
});

test('rollPeriod carries the closing count into the next opening', () => {
  const state = core.emptyState();
  state.periods[0].closing = { counts: { gin: { full: 1, partials: [0.4] } } };
  const next = core.rollPeriod(state, '2026-10-01T00:00:00.000Z');
  assert.equal(state.periods.length, 2);
  assert.equal(state.periods[0].closedAt, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(next.opening.counts, { gin: { full: 1, partials: [0.4] } });
  next.opening.counts.gin.full = 5;
  assert.equal(state.periods[0].closing.counts.gin.full, 1);
});

test('levelFraction measures between the full line and the base', () => {
  assert.equal(levelFraction({ full: 0.2, level: 0.5, base: 0.8 }), 0.5);
  assert.equal(levelFraction({ full: 0.2, level: 0.1, base: 0.8 }), 1);
  assert.equal(levelFraction({ full: 0.2, level: 0.9, base: 0.8 }), 0);
});
