// Estimate how full an open bottle is from a photo.
// The user drags three markers: where liquid would sit in a full bottle, the current level, and the base.
// Claude can place the level marker for them when photo reading is enabled.
import { h, modal, toast, busy } from './ui.js';
import { takePhoto, shrink, aiEnabled, readWithAI } from './photos.js';

export function levelFraction({ full, level, base }) {
  if (base <= full) return 0;
  return Math.min(1, Math.max(0, (base - level) / (base - full)));
}

export async function measureBottle(product) {
  const [file] = await takePhoto();
  if (!file) return null;
  const blob = await shrink(file, 1200, 0.8);
  const url = URL.createObjectURL(blob);
  const useAI = await aiEnabled();

  const result = await modal((close) => {
    // Marker positions as a fraction of image height.
    const pos = { full: 0.3, level: 0.55, base: 0.9 };
    const stage = h('div.bottle-stage');
    const img = h('img', { src: url, alt: 'Bottle photo', draggable: false });
    const markers = {
      full: h('div.marker.full', h('span', 'Full line')),
      level: h('div.marker.level', h('span', 'Liquid level')),
      base: h('div.marker.base', h('span', 'Bottom')),
    };
    const readout = h('div.readout');
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1 });
    const aiNote = h('p.muted.small');

    const render = () => {
      for (const k in markers) markers[k].style.top = `${pos[k] * 100}%`;
      const f = levelFraction(pos);
      readout.textContent = `${Math.round(f * 100)}% left`;
      slider.value = Math.round(f * 100);
    };

    let dragging = null;
    stage.addEventListener('pointerdown', (e) => {
      const rect = stage.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height;
      dragging = Object.keys(pos).sort((a, b) => Math.abs(pos[a] - y) - Math.abs(pos[b] - y))[0];
      stage.setPointerCapture(e.pointerId);
      move(e);
    });
    const move = (e) => {
      if (!dragging) return;
      const rect = stage.getBoundingClientRect();
      pos[dragging] = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      render();
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', () => { dragging = null; });
    slider.addEventListener('input', () => {
      pos.level = pos.base - (slider.value / 100) * (pos.base - pos.full);
      render();
    });

    stage.append(img, ...Object.values(markers));
    render();

    const aiButton = useAI && h('button.secondary', 'Estimate with AI');
    if (aiButton) {
      aiButton.onclick = busy(aiButton, async () => {
        try {
          const est = await readWithAI('bottle', [blob], { product: product ? `${product.name}${product.sizeMl ? ` (${product.sizeMl}ml)` : ''}` : '' });
          pos.level = pos.base - est.fraction * (pos.base - pos.full);
          render();
          aiNote.textContent = `AI: ${Math.round(est.fraction * 100)}% (${est.confidence} confidence). ${est.notes || ''}`;
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    return [
      h('p.muted.small', 'Drag the lines: green to where a full bottle fills to, blue to the liquid now, red to the inside bottom.'),
      stage,
      readout,
      h('label', 'Fine tune', slider),
      aiNote,
      h('div.row.end', aiButton, h('button', { onclick: () => close(levelFraction(pos)) }, 'Use this')),
    ];
  }, { title: product ? `Open bottle: ${product.name}` : 'Open bottle' });

  URL.revokeObjectURL(url);
  return result == null ? null : { fraction: Math.round(result * 100) / 100, blob };
}
