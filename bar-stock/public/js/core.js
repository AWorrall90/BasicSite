// Pure stock-keeping logic. No DOM access, so it runs in the browser and under node:test.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

// A count is { full, partials: [fractions of an opened unit] }.
export function countTotal(count) {
  if (count == null) return 0;
  if (typeof count === 'number') return count;
  const partials = (count.partials || []).reduce((s, p) => s + (Number(p) || 0), 0);
  return (Number(count.full) || 0) + partials;
}

// ---------- CSV ----------

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

export function parseCSV(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

// Find the header row and the most likely item-name and quantity columns of an ePOS export.
export function guessColumns(rows) {
  // Most specific words first, so "Description" beats a "PLU" code column.
  const nameWords = ['description', 'item', 'product', 'name', 'menu', 'plu'];
  const qtyWords = ['qty', 'quantity', 'sold', 'count', 'units', 'volume', 'no.'];
  const bestCol = (cells, words, skip) => {
    let col = -1; let rank = Infinity;
    cells.forEach((c, i) => {
      const r = words.findIndex((w) => c.includes(w));
      if (i !== skip && r >= 0 && r < rank) { col = i; rank = r; }
    });
    return col;
  };
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map((c) => c.toLowerCase());
    const nameCol = bestCol(cells, nameWords, -1);
    const qtyCol = bestCol(cells, qtyWords, nameCol);
    if (nameCol >= 0 && qtyCol >= 0) return { headerRow: r, nameCol, qtyCol };
  }
  // No recognisable header: first text column and first numeric column.
  const sample = rows[1] || rows[0] || [];
  const qtyCol = sample.findIndex((c) => c !== '' && !isNaN(parseNumber(c)));
  const nameCol = sample.findIndex((c, i) => i !== qtyCol && isNaN(parseNumber(c)));
  return { headerRow: -1, nameCol: Math.max(nameCol, 0), qtyCol: Math.max(qtyCol, 1) };
}

export function parseNumber(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[£$€,\s]/g, '');
  return cleaned === '' ? NaN : Number(cleaned);
}

// Turn CSV rows into sales lines, summing duplicate item names.
export function salesLinesFromRows(rows, { headerRow, nameCol, qtyCol }) {
  const totals = new Map();
  rows.slice(headerRow + 1).forEach((r) => {
    const name = (r[nameCol] || '').trim();
    const qty = parseNumber(r[qtyCol]);
    if (!name || isNaN(qty) || /^(sub)?total/i.test(name)) return;
    totals.set(name, (totals.get(name) || 0) + qty);
  });
  return [...totals].map(([posName, sold]) => ({ posName, sold }));
}

// ---------- Name matching ----------

function bigrams(s) {
  const out = new Map();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

// Dice coefficient on character bigrams, 0..1.
// Sizes and measures ("25ml", "70cl", "6 x") say little about which product a line is.
const SIZE_WORDS = /\b(\d+(\.\d+)?\s*(ml|cl|ltr|litre|l|x)|x\s*\d+|\d+)\b/g;

// 0..1. Dice coefficient on character bigrams, boosted when every word of one name is in the other
// (so a till's "Gordons 25ml" finds "Gordon's Gin").
export function similarity(a, b) {
  a = normalize(a).replace(SIZE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  b = normalize(b).replace(SIZE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a); const B = bigrams(b);
  let overlap = 0; let size = 0;
  for (const [g, n] of A) { overlap += Math.min(n, B.get(g) || 0); size += n; }
  for (const n of B.values()) size += n;
  const dice = (2 * overlap) / size;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const longWords = new Set(long.split(' '));
  const contained = short.length >= 4 && short.split(' ').every((w) => longWords.has(w));
  return contained ? Math.max(dice, 0.8) : dice;
}

export function bestProductMatch(name, products, threshold = 0.5) {
  let best = null; let score = 0;
  for (const p of products) {
    const s = Math.max(similarity(name, p.name), ...(p.aliases || []).map((a) => similarity(name, a)));
    if (s > score) { best = p; score = s; }
  }
  return score >= threshold ? { product: best, score } : null;
}

// Resolve a delivery or sales line to a product: remembered mapping first, then fuzzy match.
export function resolveLine(name, map, products, threshold) {
  const remembered = map[normalize(name)];
  if (remembered && remembered.productId === null) return { ...remembered, source: 'ignored' };
  if (remembered && products.some((p) => p.id === remembered.productId)) {
    return { ...remembered, source: 'remembered' };
  }
  const m = bestProductMatch(name, products, threshold);
  return m ? { productId: m.product.id, source: 'guess', score: m.score } : null;
}

// Default amount of stock (in product units) one ePOS sale uses.
export function defaultUnitsPerSale(product) {
  if (!product) return 1;
  if (product.unit === 'bottle' && product.sizeMl) {
    const pour = product.category === 'Wine' ? 175 : 25;
    return round(pour / product.sizeMl, 4);
  }
  if (product.unit === 'keg' && product.sizeMl) return round(568 / product.sizeMl, 5); // a pint
  return 1;
}

// ---------- Period maths ----------

export function deliveredUnits(period, productId) {
  return (period.deliveries || []).reduce((sum, d) => sum + d.lines
    .filter((l) => l.productId === productId)
    .reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.packSize) || 1), 0), 0);
}

export function soldUnits(period, productId) {
  return (period.sales || []).reduce((sum, s) => sum + s.lines
    .filter((l) => l.productId === productId)
    .reduce((t, l) => t + (Number(l.sold) || 0) * (Number(l.unitsPerSale) || 0), 0), 0);
}

// Opening + delivered - sold = expected; expected - counted = variance (positive means stock is missing).
export function computeReport(period, products) {
  const opening = period.opening?.counts || {};
  const closing = period.closing?.counts || {};
  const rows = products.map((p) => {
    const open = countTotal(opening[p.id]);
    const delivered = deliveredUnits(period, p.id);
    const sold = soldUnits(period, p.id);
    const expected = open + delivered - sold;
    const counted = period.closing ? countTotal(closing[p.id]) : null;
    const variance = counted == null ? null : expected - counted;
    const cost = Number(p.cost) || 0;
    return {
      productId: p.id,
      name: p.name,
      category: p.category || 'Other',
      unit: p.unit,
      opening: round(open),
      delivered: round(delivered),
      sold: round(sold),
      expected: round(expected),
      counted: counted == null ? null : round(counted),
      variance: variance == null ? null : round(variance),
      varianceValue: variance == null ? null : round(variance * cost),
      variancePct: variance == null || !(open + delivered) ? null : round((variance / (open + delivered)) * 100, 1),
    };
  }).filter((r) => r.opening || r.delivered || r.sold || r.counted);
  const totals = {
    varianceValue: round(rows.reduce((s, r) => s + (r.varianceValue || 0), 0)),
    deliveredValue: round(products.reduce((s, p) => s + deliveredUnits(period, p.id) * (Number(p.cost) || 0), 0)),
  };
  return { rows, totals };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCSV(report) {
  const head = ['Product', 'Category', 'Opening', 'Delivered', 'Sold', 'Expected', 'Counted', 'Variance', 'Variance %', 'Variance value'];
  const lines = report.rows.map((r) => [r.name, r.category, r.opening, r.delivered, r.sold, r.expected,
    r.counted, r.variance, r.variancePct, r.varianceValue]);
  return [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\n');
}

// Close a period and start the next one, carrying the closing count over as the new opening count.
export function rollPeriod(state, now = new Date().toISOString()) {
  const current = state.periods[state.periods.length - 1];
  current.closedAt = now;
  const next = newPeriod(now);
  next.opening = { at: now, counts: structuredClone(current.closing.counts), photoIds: [] };
  state.periods.push(next);
  return next;
}

export function newPeriod(now = new Date().toISOString()) {
  return { id: uid(), startedAt: now, opening: null, deliveries: [], sales: [], closing: null, closedAt: null };
}

export function emptyState() {
  return { version: 1, products: [], posMap: {}, supplierMap: {}, periods: [newPeriod()] };
}
