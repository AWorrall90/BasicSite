// Small DOM helpers shared by the screens.

// h('div.card', {onclick}, child, ...) -> element
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function toast(message, kind = 'info') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h(`div.toast.${kind}`, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

// Shows a full-screen sheet. build(close) returns the content; close(value) resolves the promise.
export function modal(build, { title } = {}) {
  return new Promise((resolve) => {
    const backdrop = h('div.modal-backdrop');
    const close = (value) => { backdrop.remove(); resolve(value); };
    const sheet = h('div.modal',
      h('header.modal-head', h('h2', title || ''), h('button.icon', { onclick: () => close(null), 'aria-label': 'Close' }, '✕')),
      h('div.modal-body', build(close)));
    backdrop.append(sheet);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.body.append(backdrop);
  });
}

export function confirmDialog(message, okLabel = 'OK') {
  return modal((close) => [
    h('p', message),
    h('div.row.end', h('button.secondary', { onclick: () => close(false) }, 'Cancel'), h('button', { onclick: () => close(true) }, okLabel)),
  ], { title: 'Are you sure?' });
}

export function busy(button, promiseFn) {
  return async (...args) => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try { return await promiseFn(...args); }
    finally { button.disabled = false; button.textContent = label; }
  };
}

export function fmtNum(n, dp = 2) {
  if (n == null || isNaN(n)) return '–';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: dp });
}

export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '–';
  return Number(n).toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
}

export function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
}

export function download(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
