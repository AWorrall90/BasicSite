import * as core from './core.js';
import * as db from './db.js';
import { h, toast, modal, confirmDialog, busy, fmtNum, fmtMoney, fmtDate, download } from './ui.js';
import { takePhoto, pickFile, shrink, aiEnabled, readWithAI } from './photos.js';
import { measureBottle } from './bottle.js';

const CATEGORIES = ['Spirits', 'Liqueurs', 'Wine', 'Draught', 'Bottled beer & cider', 'Soft drinks', 'Other'];
const UNITS = { bottle: 'Bottle', keg: 'Keg', each: 'Each (can, pack, item)' };

let state;
const view = document.getElementById('view');

const current = () => state.periods[state.periods.length - 1];
const productById = (id) => state.products.find((p) => p.id === id);
const sortedProducts = () => [...state.products].sort((a, b) =>
  CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));

async function save() {
  await db.saveState(state);
}

function go(hash) { location.hash = hash; }

// ---------- Photos ----------

async function addPhotos(maxSide) {
  const files = await takePhoto({ multiple: true });
  const ids = [];
  for (const f of files) {
    const id = core.uid();
    await db.savePhoto(id, await shrink(f, maxSide));
    ids.push(id);
  }
  return ids;
}

function photoStrip(ids, onRemove) {
  return h('div.photos', ids.map((id) => {
    const img = h('img', { alt: 'Photo' });
    db.getPhoto(id).then((blob) => { if (blob) img.src = URL.createObjectURL(blob); });
    img.onclick = () => modal(() => h('img.full', { src: img.src }), { title: 'Photo' });
    return h('div.thumb', img, onRemove && h('button.icon.remove', { onclick: () => onRemove(id), 'aria-label': 'Remove photo' }, '✕'));
  }));
}

// ---------- Products ----------

function productSelect(value, onChange, { allowIgnore = false, suggestedName = '', suggestedSize = null } = {}) {
  const sel = h('select',
    h('option', { value: '' }, '— choose product —'),
    allowIgnore && h('option', { value: '__ignore' }, 'Not stock (ignore)'),
    sortedProducts().map((p) => h('option', { value: p.id }, productLabel(p))),
    h('option', { value: '__new' }, '+ New product…'));
  sel.value = value === null && allowIgnore ? '__ignore' : value || '';
  sel.onchange = async () => {
    if (sel.value === '__new') {
      const p = await editProduct({ name: suggestedName, sizeMl: suggestedSize });
      if (p) {
        sel.insertBefore(h('option', { value: p.id }, productLabel(p)), sel.lastChild);
        sel.value = p.id;
        onChange(p.id);
      } else sel.value = value || '';
      return;
    }
    onChange(sel.value === '__ignore' ? null : sel.value || undefined);
  };
  return sel;
}

function productLabel(p) {
  if (!p.sizeMl || /\d\s*(ml|cl|l|ltr)\b/i.test(p.name)) return p.name;
  return `${p.name} ${p.sizeMl >= 1000 ? `${p.sizeMl / 1000}L` : `${p.sizeMl}ml`}`;
}

function guessCategory(name) {
  const n = core.normalize(name);
  if (/vodka|gin|rum|whisk|bourbon|tequila|brandy|cognac/.test(n)) return 'Spirits';
  if (/wine|prosecco|champagne|rose|merlot|sauvignon|pinot|rioja/.test(n)) return 'Wine';
  if (/keg|draught|cask/.test(n)) return 'Draught';
  if (/lager|ale|beer|cider|ipa|stout/.test(n)) return 'Bottled beer & cider';
  if (/cola|coke|tonic|lemonade|juice|water|soda|j2o/.test(n)) return 'Soft drinks';
  return 'Other';
}

function editProduct(existing = {}) {
  const isNew = !existing.id;
  const p = { category: guessCategory(existing.name || ''), unit: 'bottle', aliases: [], ...existing };
  if (isNew && p.category === 'Draught') p.unit = 'keg';
  return modal((close) => {
    const name = h('input', { value: p.name || '', placeholder: 'e.g. Gordon\'s Gin', required: true });
    const category = h('select', CATEGORIES.map((c) => h('option', c)));
    category.value = p.category;
    const unit = h('select', Object.entries(UNITS).map(([v, l]) => h('option', { value: v }, l)));
    unit.value = p.unit;
    const size = h('input', { type: 'number', inputMode: 'decimal', value: p.sizeMl ?? '', placeholder: 'e.g. 700' });
    const cost = h('input', { type: 'number', inputMode: 'decimal', step: '0.01', value: p.cost ?? '', placeholder: 'cost per bottle/keg/item' });
    const aliases = h('input', { value: (p.aliases || []).join(', '), placeholder: 'other names on invoices / till' });
    const submit = async () => {
      if (!name.value.trim()) return toast('Give the product a name', 'error');
      Object.assign(p, {
        id: p.id || core.uid(),
        name: name.value.trim(),
        category: category.value,
        unit: unit.value,
        sizeMl: size.value ? Number(size.value) : null,
        cost: cost.value ? Number(cost.value) : null,
        aliases: aliases.value.split(',').map((a) => a.trim()).filter(Boolean),
      });
      if (isNew) state.products.push(p);
      else Object.assign(productById(p.id), p);
      await save();
      close(p);
    };
    return [
      h('label', 'Name', name),
      h('div.grid2', h('label', 'Category', category), h('label', 'Counted as', unit)),
      h('div.grid2', h('label', 'Size (ml)', size), h('label', 'Cost each (£)', cost)),
      h('label', 'Also known as', aliases),
      h('div.row.end',
        !isNew && h('button.danger', { onclick: async () => {
          if (!(await confirmDialog(`Delete ${p.name}? It will disappear from reports.`, 'Delete'))) return;
          state.products = state.products.filter((x) => x.id !== p.id);
          await save();
          close(null);
          render();
        } }, 'Delete'),
        h('button', { onclick: submit }, isNew ? 'Add product' : 'Save')),
    ];
  }, { title: isNew ? 'New product' : 'Edit product' });
}

function productsScreen() {
  const list = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search products' });
  const draw = () => {
    const q = core.normalize(search.value);
    const items = sortedProducts().filter((p) => !q || core.normalize(p.name).includes(q));
    let lastCat;
    list.replaceChildren(...items.flatMap((p) => {
      const out = [];
      if (p.category !== lastCat) { lastCat = p.category; out.push(h('h3.cat', p.category)); }
      out.push(h('button.list-item', { onclick: async () => { await editProduct(p); draw(); } },
        h('span', productLabel(p)), h('span.muted', p.cost ? fmtMoney(p.cost) : 'no cost')));
      return out;
    }));
    if (!items.length) list.append(h('p.empty', state.products.length ? 'No matches.' : 'No products yet. Add them here, or create them as you read your first invoice.'));
  };
  search.oninput = draw;
  draw();
  return [
    h('div.row.between', h('h1', 'Products'), h('button', { onclick: async () => { await editProduct(); draw(); } }, '+ Add')),
    search,
    list,
  ];
}

// ---------- Home ----------

function homeScreen() {
  const p = current();
  const step = (done, title, detail, action) => h(`div.card.step${done ? '.done' : ''}`,
    h('div', h('strong', `${done ? '✓ ' : ''}${title}`), h('div.muted.small', detail)), action);

  return [
    h('h1', 'Stock period'),
    h('p.muted', `Started ${fmtDate(p.startedAt)}`),
    !state.products.length && h('div.card.notice', 'Start by declaring your opening stock. You can add products as you go, or from an invoice photo.'),
    step(Boolean(p.opening), 'Opening stock',
      p.opening ? `Counted ${fmtDate(p.opening.at)}` : 'Count what is on the shelves now',
      h('button', { onclick: () => go('#/count/opening') }, p.opening ? 'Edit' : 'Count')),
    step(p.deliveries.length > 0, 'Stock in',
      `${p.deliveries.length} deliver${p.deliveries.length === 1 ? 'y' : 'ies'}: photograph invoices & delivery notes`,
      h('button', { onclick: () => go('#/delivery/new') }, '+ Delivery')),
    p.deliveries.length > 0 && h('div.sublist', [...p.deliveries].reverse().map((d) => h('button.list-item', { onclick: () => go(`#/delivery/${d.id}`) },
      h('span', `${d.supplier || 'Delivery'}${d.reference ? ` #${d.reference}` : ''}`), h('span.muted', `${fmtDate(d.date)} · ${d.lines.length} lines`)))),
    step(p.sales.length > 0, 'Stock out',
      `${p.sales.length} sales report${p.sales.length === 1 ? '' : 's'}: import from the ePOS or photograph it`,
      h('button', { onclick: () => go('#/sales/new') }, '+ Sales')),
    p.sales.length > 0 && h('div.sublist', [...p.sales].reverse().map((s) => h('button.list-item', { onclick: () => go(`#/sales/${s.id}`) },
      h('span', s.label || 'Sales'), h('span.muted', `${fmtDate(s.from)}${s.to && s.to !== s.from ? ` – ${fmtDate(s.to)}` : ''} · ${s.lines.length} items`)))),
    step(Boolean(p.closing), 'Closing stock',
      p.closing ? `Counted ${fmtDate(p.closing.at)}` : 'Count again at the end of the period',
      h('button', { onclick: () => go('#/count/closing'), disabled: !p.opening }, p.closing ? 'Edit' : 'Count')),
    h('button.wide', { onclick: () => go('#/report') }, p.closing ? 'View stock result' : 'View expected stock'),
  ];
}

// ---------- Stock counts ----------

function countScreen(kind) {
  const period = current();
  const prev = state.periods[state.periods.length - 2];
  const source = period[kind]?.counts || (kind === 'opening' && prev?.closing?.counts) || {};
  const counts = structuredClone(source);
  const photoIds = [...(period[kind]?.photoIds || [])];
  let dirty = false;

  const list = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search products' });
  const total = h('span.muted');

  const row = (p) => {
    const c = counts[p.id] ??= { full: 0, partials: [] };
    const totalEl = h('span.count-total');
    const partialsEl = h('div.partials');
    const update = () => { dirty = true; totalEl.textContent = fmtNum(core.countTotal(c)); };
    const drawPartials = () => {
      partialsEl.replaceChildren(...c.partials.map((f, i) => h('button.chip', {
        onclick: () => { c.partials.splice(i, 1); drawPartials(); update(); }, title: 'Tap to remove',
      }, `${Math.round(f * 100)}% ✕`)));
    };
    const full = h('input.qty', { type: 'number', inputMode: 'decimal', min: 0, value: c.full || '', placeholder: '0' });
    full.oninput = () => { c.full = Number(full.value) || 0; update(); };
    const step = (d) => h('button.step', { onclick: () => { c.full = Math.max(0, (c.full || 0) + d); full.value = c.full || ''; update(); } }, d > 0 ? '+' : '−');

    const addOpen = h('button.secondary.small', '📷 Open bottle');
    addOpen.onclick = async () => {
      const res = await measureBottle(p);
      if (!res) return;
      const id = core.uid();
      await db.savePhoto(id, res.blob);
      photoIds.push(id);
      c.partials.push(res.fraction);
      drawPartials(); update();
    };
    const addManual = h('button.secondary.small', { onclick: async () => {
      const pct = await askNumber('How full is it? (%)', 50);
      if (pct == null) return;
      c.partials.push(Math.min(1, Math.max(0, pct / 100)));
      drawPartials(); update();
    } }, '+ %');

    drawPartials();
    update(); dirty = false;
    return h('div.count-row',
      h('div.count-head', h('span', productLabel(p)), totalEl),
      h('div.count-controls', step(-1), full, step(1),
        p.unit !== 'each' && addOpen, p.unit !== 'each' && addManual),
      partialsEl);
  };

  const draw = () => {
    const q = core.normalize(search.value);
    let lastCat;
    const items = sortedProducts().filter((p) => !q || core.normalize(p.name).includes(q));
    list.replaceChildren(...items.flatMap((p) => {
      const out = [];
      if (p.category !== lastCat) { lastCat = p.category; out.push(h('h3.cat', p.category)); }
      out.push(row(p));
      return out;
    }));
    total.textContent = `${state.products.length} products`;
  };
  search.oninput = draw;
  draw();

  const saveCount = async () => {
    for (const id of Object.keys(counts)) if (!core.countTotal(counts[id])) delete counts[id];
    period[kind] = { at: new Date().toISOString(), counts, photoIds };
    await save();
    dirty = false;
    toast(`${kind === 'opening' ? 'Opening' : 'Closing'} stock saved`);
    go(kind === 'closing' ? '#/report' : '#/');
  };
  window.onbeforeunload = () => (dirty ? true : undefined);

  return [
    h('h1', kind === 'opening' ? 'Opening stock' : 'Closing stock'),
    h('p.muted.small', 'Enter full, sealed units. For each opened bottle, tap 📷 to photograph it and mark the level, or + % to type it.'),
    !period[kind] && kind === 'opening' && prev?.closing && h('p.notice.small', 'Pre-filled from the last closing count.'),
    h('div.row', search, h('button.secondary', { onclick: async () => { await editProduct(); draw(); } }, '+ Product')),
    total,
    list,
    h('div.sticky-actions', h('button.wide', { onclick: saveCount }, 'Save count')),
  ];
}

function askNumber(title, initial) {
  return modal((close) => {
    const input = h('input', { type: 'number', inputMode: 'decimal', value: initial });
    setTimeout(() => input.select(), 50);
    input.onkeydown = (e) => { if (e.key === 'Enter') close(Number(input.value)); };
    return [input, h('div.row.end', h('button', { onclick: () => close(Number(input.value)) }, 'OK'))];
  }, { title });
}

// ---------- Deliveries (stock in) ----------

function deliveryScreen(id) {
  const period = current();
  const existing = period.deliveries.find((d) => d.id === id);
  if (id !== 'new' && !existing) return [h('p', 'Delivery not found.')];
  const d = structuredClone(existing || {
    id: core.uid(), date: new Date().toISOString().slice(0, 10), supplier: '', reference: '', photoIds: [], lines: [],
  });

  const supplier = h('input', { value: d.supplier, placeholder: 'Supplier' });
  const reference = h('input', { value: d.reference, placeholder: 'Invoice / note no.' });
  const date = h('input', { type: 'date', value: d.date });
  const photos = h('div');
  const lines = h('div');
  const readBtn = h('button', 'Read invoice with AI');
  readBtn.hidden = true;
  aiEnabled().then((on) => { readBtn.hidden = !on; });

  const drawPhotos = () => photos.replaceChildren(photoStrip(d.photoIds, (pid) => {
    d.photoIds = d.photoIds.filter((x) => x !== pid);
    db.deletePhoto(pid);
    drawPhotos();
  }));

  const drawLines = () => {
    lines.replaceChildren(...d.lines.map((l, i) => {
      const num = (key, label, attrs = {}) => {
        const input = h('input', { type: 'number', inputMode: 'decimal', value: l[key] ?? '', ...attrs });
        input.oninput = () => { l[key] = input.value === '' ? null : Number(input.value); };
        return h('label.small', label, input);
      };
      const desc = h('input', { value: l.description || '', placeholder: 'Description' });
      desc.oninput = () => { l.description = desc.value; };
      return h(`div.card.line${l.productId ? '' : '.unmatched'}`,
        h('div.row', desc, h('button.icon', { onclick: () => { d.lines.splice(i, 1); drawLines(); }, 'aria-label': 'Remove line' }, '✕')),
        productSelect(l.productId, (pid) => { l.productId = pid; drawLines(); },
          { suggestedName: l.description, suggestedSize: l.unitSizeMl }),
        h('div.grid3', num('qty', 'Qty', { min: 0 }), num('packSize', 'Per pack', { min: 1 }), num('lineTotal', 'Line £', { step: '0.01' })),
        l.productId && h('div.muted.small', `= ${fmtNum((Number(l.qty) || 0) * (Number(l.packSize) || 1))} × ${productLabel(productById(l.productId))}`));
    }));
    if (!d.lines.length) lines.append(h('p.empty', 'No lines yet. Photograph the invoice and read it, or add lines by hand.'));
  };

  readBtn.onclick = busy(readBtn, async () => {
    if (!d.photoIds.length) return toast('Take a photo of the invoice first', 'error');
    try {
      const blobs = (await Promise.all(d.photoIds.map(db.getPhoto))).filter(Boolean);
      const catalogue = state.products.map((p) => ({ id: p.id, name: productLabel(p), aliases: p.aliases }));
      const res = await readWithAI('invoice', blobs, { products: catalogue });
      if (res.supplier && !supplier.value) supplier.value = res.supplier;
      if (res.reference && !reference.value) reference.value = res.reference;
      if (res.date && /^\d{4}-\d{2}-\d{2}$/.test(res.date)) date.value = res.date;
      d.lines = res.lines.map((l) => {
        const remembered = core.resolveLine(l.description, state.supplierMap, state.products, 0.6);
        const productId = remembered?.source === 'remembered' ? remembered.productId
          : productById(l.productId)?.id || remembered?.productId;
        return { description: l.description, qty: l.quantity, packSize: remembered?.packSize || l.packSize || 1,
          lineTotal: l.lineTotal, unitSizeMl: l.unitSizeMl, productId };
      });
      drawLines();
      toast(`Read ${d.lines.length} lines. Check them before saving.`);
    } catch (err) { toast(err.message, 'error'); }
  });

  const saveDelivery = async () => {
    const missing = d.lines.filter((l) => !l.productId).length;
    if (missing) return toast(`Choose a product for ${missing} line${missing > 1 ? 's' : ''}`, 'error');
    Object.assign(d, { supplier: supplier.value.trim(), reference: reference.value.trim(), date: date.value });
    for (const l of d.lines) {
      if (l.description) state.supplierMap[core.normalize(l.description)] = { productId: l.productId, packSize: l.packSize || 1 };
      const units = (Number(l.qty) || 0) * (Number(l.packSize) || 1);
      if (l.lineTotal && units) productById(l.productId).cost = core.round(l.lineTotal / units);
    }
    const idx = period.deliveries.findIndex((x) => x.id === d.id);
    if (idx >= 0) period.deliveries[idx] = d; else period.deliveries.push(d);
    await save();
    toast('Delivery saved');
    go('#/');
  };

  drawPhotos();
  drawLines();
  return [
    h('h1', existing ? 'Delivery' : 'New delivery'),
    h('div.card',
      h('div.row', h('button', { onclick: async () => { d.photoIds.push(...await addPhotos(2000)); drawPhotos(); } }, '📷 Photo of invoice'), readBtn),
      photos),
    h('div.grid2', supplier, reference),
    h('label', 'Delivery date', date),
    h('h2', 'Lines'),
    lines,
    h('button.secondary', { onclick: () => { d.lines.push({ description: '', qty: 1, packSize: 1 }); drawLines(); } }, '+ Add line'),
    h('div.sticky-actions',
      existing && h('button.danger', { onclick: async () => {
        if (!(await confirmDialog('Delete this delivery?', 'Delete'))) return;
        period.deliveries = period.deliveries.filter((x) => x.id !== d.id);
        await save(); go('#/');
      } }, 'Delete'),
      h('button.wide', { onclick: saveDelivery }, 'Save delivery')),
  ];
}

// ---------- Sales (stock out) ----------

function chooseColumns(rows) {
  const guess = core.guessColumns(rows);
  return modal((close) => {
    const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
    const colSelect = (value) => {
      const s = h('select', Array.from({ length: width }, (_, i) => h('option', { value: i }, `Column ${i + 1}: ${rows[Math.max(guess.headerRow, 0)][i] || ''}`)));
      s.value = value;
      return s;
    };
    const nameCol = colSelect(guess.nameCol);
    const qtyCol = colSelect(guess.qtyCol);
    const preview = h('div.preview');
    const drawPreview = () => {
      const cfg = { headerRow: guess.headerRow, nameCol: Number(nameCol.value), qtyCol: Number(qtyCol.value) };
      const lines = core.salesLinesFromRows(rows, cfg);
      preview.replaceChildren(h('p.muted.small', `${lines.length} items found`),
        ...lines.slice(0, 6).map((l) => h('div.small', `${l.posName}: ${l.sold}`)));
      return lines;
    };
    nameCol.onchange = drawPreview; qtyCol.onchange = drawPreview;
    drawPreview();
    return [
      h('label', 'Item name column', nameCol),
      h('label', 'Quantity sold column', qtyCol),
      preview,
      h('div.row.end', h('button', { onclick: () => close(drawPreview()) }, 'Use these')),
    ];
  }, { title: 'Match the ePOS columns' });
}

function salesScreen(id) {
  const period = current();
  const existing = period.sales.find((s) => s.id === id);
  if (id !== 'new' && !existing) return [h('p', 'Sales report not found.')];
  const today = new Date().toISOString().slice(0, 10);
  const s = structuredClone(existing || { id: core.uid(), label: '', from: today, to: today, source: 'manual', photoIds: [], lines: [] });

  const label = h('input', { value: s.label, placeholder: 'Name, e.g. Week 12 ePOS' });
  const from = h('input', { type: 'date', value: s.from });
  const to = h('input', { type: 'date', value: s.to });
  const photos = h('div');
  const lines = h('div');
  const readBtn = h('button', 'Read report with AI');
  readBtn.hidden = true;

  const drawPhotos = () => {
    photos.replaceChildren(photoStrip(s.photoIds, (pid) => {
      s.photoIds = s.photoIds.filter((x) => x !== pid); db.deletePhoto(pid); drawPhotos();
    }));
    aiEnabled().then((on) => { readBtn.hidden = !on || !s.photoIds.length; });
  };

  const addLines = (incoming) => {
    for (const { posName, sold } of incoming) {
      const match = core.resolveLine(posName, state.posMap, state.products, 0.6);
      const product = productById(match?.productId);
      s.lines.push({ posName, sold, productId: match ? match.productId : undefined,
        unitsPerSale: match?.unitsPerSale ?? core.defaultUnitsPerSale(product) });
    }
    drawLines();
  };

  const drawLines = () => {
    const unmatched = s.lines.filter((l) => l.productId === undefined).length;
    lines.replaceChildren(
      unmatched ? h('p.notice.small', `${unmatched} item${unmatched > 1 ? 's' : ''} need a product, or mark as "Not stock" (e.g. food). Choices are remembered next time.`) : '',
      ...s.lines.map((l, i) => {
        const product = productById(l.productId);
        const byMl = product && product.unit !== 'each' && product.sizeMl;
        const perSale = h('input', { type: 'number', inputMode: 'decimal',
          value: byMl ? core.round(l.unitsPerSale * product.sizeMl, 1) : l.unitsPerSale });
        perSale.oninput = () => { l.unitsPerSale = byMl ? Number(perSale.value) / product.sizeMl : Number(perSale.value); };
        const name = h('input', { value: l.posName, placeholder: 'Till item' });
        name.oninput = () => { l.posName = name.value; };
        const sold = h('input', { type: 'number', inputMode: 'decimal', value: l.sold });
        sold.oninput = () => { l.sold = Number(sold.value) || 0; };
        return h(`div.card.line${l.productId === undefined ? '.unmatched' : ''}${l.productId === null ? '.ignored' : ''}`,
          h('div.row', name, h('button.icon', { onclick: () => { s.lines.splice(i, 1); drawLines(); }, 'aria-label': 'Remove' }, '✕')),
          productSelect(l.productId, (pid) => {
            l.productId = pid;
            l.unitsPerSale = core.defaultUnitsPerSale(productById(pid));
            drawLines();
          }, { allowIgnore: true, suggestedName: l.posName }),
          l.productId !== null && h('div.grid2', h('label.small', 'Sold', sold),
            product && h('label.small', byMl ? 'ml per sale' : 'Units per sale', perSale)));
      }));
    if (!s.lines.length) lines.append(h('p.empty', 'Import the ePOS export (CSV), photograph the printed report, or add items by hand.'));
  };

  const importCsv = async () => {
    const file = await pickFile('.csv,text/csv,.txt,.tsv');
    if (!file) return;
    const rows = core.parseCSV(await file.text());
    if (rows.length < 2) return toast('That file has no rows', 'error');
    const picked = await chooseColumns(rows);
    if (!picked) return;
    s.source = 'csv';
    if (!label.value) label.value = file.name.replace(/\.[^.]+$/, '');
    addLines(picked);
    toast(`Imported ${picked.length} items`);
  };

  readBtn.onclick = busy(readBtn, async () => {
    try {
      const blobs = (await Promise.all(s.photoIds.map(db.getPhoto))).filter(Boolean);
      const res = await readWithAI('sales', blobs);
      if (res.from) from.value = res.from.slice(0, 10);
      if (res.to) to.value = res.to.slice(0, 10);
      s.source = 'photo';
      s.lines = [];
      addLines(res.lines.map((l) => ({ posName: l.itemName, sold: l.quantitySold })));
      toast(`Read ${res.lines.length} items. Check them before saving.`);
    } catch (err) { toast(err.message, 'error'); }
  });

  const saveSales = async () => {
    const missing = s.lines.filter((l) => l.productId === undefined).length;
    if (missing) return toast(`Choose a product (or "Not stock") for ${missing} item${missing > 1 ? 's' : ''}`, 'error');
    Object.assign(s, { label: label.value.trim(), from: from.value, to: to.value });
    for (const l of s.lines) {
      if (l.posName) state.posMap[core.normalize(l.posName)] = { productId: l.productId, unitsPerSale: l.unitsPerSale };
    }
    const idx = period.sales.findIndex((x) => x.id === s.id);
    if (idx >= 0) period.sales[idx] = s; else period.sales.push(s);
    await save();
    toast('Sales saved');
    go('#/');
  };

  drawPhotos();
  drawLines();
  return [
    h('h1', existing ? 'Sales' : 'Add sales'),
    h('div.card',
      h('div.row', h('button', { onclick: importCsv }, '⬆ Import ePOS CSV'),
        h('button.secondary', { onclick: async () => { s.photoIds.push(...await addPhotos(2000)); drawPhotos(); } }, '📷 Photo of report')),
      photos, readBtn),
    label,
    h('div.grid2', h('label', 'From', from), h('label', 'To', to)),
    h('h2', 'Items sold'),
    lines,
    h('button.secondary', { onclick: () => { s.lines.push({ posName: '', sold: 1, productId: undefined, unitsPerSale: 1 }); drawLines(); } }, '+ Add item'),
    h('div.sticky-actions',
      existing && h('button.danger', { onclick: async () => {
        if (!(await confirmDialog('Delete these sales?', 'Delete'))) return;
        period.sales = period.sales.filter((x) => x.id !== s.id);
        await save(); go('#/');
      } }, 'Delete'),
      h('button.wide', { onclick: saveSales }, 'Save sales')),
  ];
}

// ---------- Report ----------

function reportScreen(periodId) {
  const period = state.periods.find((p) => p.id === periodId) || current();
  const isCurrent = period === current();
  const report = core.computeReport(period, state.products);
  const closed = Boolean(period.closing);
  const cls = (v) => (v == null ? '' : v > 0.05 ? 'loss' : v < -0.05 ? 'gain' : '');

  // Result columns come first so they stay on screen on a phone; the working scrolls to the right.
  const table = h('table.report',
    h('thead', h('tr', h('th', 'Product'),
      closed && h('th', 'Variance'), closed && h('th', '£'), closed && h('th', 'Counted'),
      h('th', 'Expected'), h('th', 'Open'), h('th', 'In'), h('th', 'Sold'))),
    h('tbody', report.rows.map((r) => h('tr',
      h('td', r.name),
      closed && h(`td.${cls(r.variance) || 'ok'}`, fmtNum(r.variance), r.variancePct != null && h('div.small', `${r.variancePct}%`)),
      closed && h(`td.${cls(r.varianceValue) || 'ok'}`, fmtMoney(r.varianceValue)),
      closed && h('td', fmtNum(r.counted)),
      h('td', fmtNum(r.expected)), h('td', fmtNum(r.opening)), h('td', fmtNum(r.delivered)), h('td', fmtNum(r.sold))))));

  const closePeriod = async () => {
    if (!(await confirmDialog('Close this period? The closing count becomes the opening stock of a new period.', 'Close period'))) return;
    core.rollPeriod(state);
    await save();
    toast('New period started');
    go('#/');
  };

  return [
    h('h1', closed ? 'Stock result' : 'Expected stock'),
    h('p.muted', `${fmtDate(period.startedAt)} – ${period.closing ? fmtDate(period.closing.at) : 'now'}`),
    !period.opening && h('p.notice', 'No opening count yet, so expected stock starts from zero.'),
    closed && h(`div.card.summary.${cls(report.totals.varianceValue) || 'ok'}`,
      h('div.muted.small', report.totals.varianceValue > 0 ? 'Stock missing (at cost)' : 'Stock variance (at cost)'),
      h('div.big', fmtMoney(Math.abs(report.totals.varianceValue))),
      h('div.muted.small', `Deliveries this period: ${fmtMoney(report.totals.deliveredValue)}`)),
    closed && h('p.muted.small', 'Variance = expected − counted. Positive (red) means stock is unaccounted for: wastage, over-pouring, unrung sales or theft.'),
    report.rows.length ? h('div.table-wrap', table) : h('p.empty', 'Nothing recorded yet.'),
    h('div.row',
      h('button.secondary', { onclick: () => download(`stock-${period.startedAt.slice(0, 10)}.csv`, core.reportToCSV(report)) }, 'Export CSV'),
      isCurrent && closed && h('button', { onclick: closePeriod }, 'Close period & start next')),
    state.periods.length > 1 && h('div',
      h('h2', 'Previous periods'),
      state.periods.slice(0, -1).reverse().map((p) => h('button.list-item', { onclick: () => go(`#/report/${p.id}`) },
        h('span', `${fmtDate(p.startedAt)} – ${fmtDate(p.closedAt)}`),
        h('span.muted', fmtMoney(core.computeReport(p, state.products).totals.varianceValue))))),
  ];
}

// ---------- Settings ----------

function settingsScreen() {
  const status = h('p.muted.small', 'Checking photo reading…');
  aiEnabled().then((on) => {
    status.textContent = on ? 'AI photo reading is on.' : 'AI photo reading is off on this server. Photos are still stored; enter details by hand.';
  });
  return [
    h('h1', 'Settings'),
    status,
    h('div.card',
      h('h2', 'Backup'),
      h('p.muted.small', 'Data is stored on this device only. Export a backup regularly (photos are not included).'),
      h('div.row',
        h('button', { onclick: () => download(`bar-stock-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json') }, 'Export backup'),
        h('button.secondary', { onclick: async () => {
          const file = await pickFile('.json,application/json');
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (!Array.isArray(data.products) || !Array.isArray(data.periods)) throw new Error('Not a backup file');
            if (!(await confirmDialog('Replace all data on this device with the backup?', 'Restore'))) return;
            state = data; await save(); toast('Backup restored'); go('#/');
          } catch (err) { toast(err.message, 'error'); }
        } }, 'Restore backup'))),
    h('div.card',
      h('h2', 'Remembered names'),
      h('p.muted.small', `${Object.keys(state.supplierMap).length} invoice names and ${Object.keys(state.posMap).length} till items are linked to products.`),
      h('button.secondary', { onclick: async () => {
        if (!(await confirmDialog('Forget all remembered invoice and till names?', 'Forget'))) return;
        state.supplierMap = {}; state.posMap = {}; await save(); render();
      } }, 'Forget them')),
    h('div.card',
      h('h2', 'Reset'),
      h('button.danger', { onclick: async () => {
        if (!(await confirmDialog('Delete ALL products, counts, deliveries and sales on this device?', 'Delete everything'))) return;
        state = core.emptyState(); await save(); go('#/');
      } }, 'Delete all data')),
  ];
}

// ---------- Routing ----------

const routes = [
  [/^#?\/?$/, homeScreen],
  [/^#\/count\/(opening|closing)$/, countScreen],
  [/^#\/delivery\/(\w+)$/, deliveryScreen],
  [/^#\/sales\/(\w+)$/, salesScreen],
  [/^#\/report(?:\/(\w+))?$/, reportScreen],
  [/^#\/products$/, productsScreen],
  [/^#\/settings$/, settingsScreen],
];

function render() {
  window.onbeforeunload = null;
  const hash = location.hash || '#/';
  for (const [re, screen] of routes) {
    const m = hash.match(re);
    if (m) {
      view.replaceChildren(...[screen(...m.slice(1))].flat().filter(Boolean));
      break;
    }
  }
  const tab = hash.split('/')[1] || '';
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
}

async function start() {
  state = (await db.loadState()) || core.emptyState();
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
