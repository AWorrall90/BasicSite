// Taking photos with the phone camera, shrinking them, and sending them to the server to be read.

// Opens the rear camera on phones (falls back to a file picker on desktop).
export function takePhoto({ multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// Older iOS Safari rejects createImageBitmap's options, so fall back to an <img>, which applies EXIF rotation itself.
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  }
}

// Resize to keep uploads and storage small while keeping invoice text legible.
export async function shrink(file, maxSide = 2000, quality = 0.85) {
  const bitmap = await decode(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let aiStatus;
export async function aiEnabled() {
  aiStatus ??= fetch('/api/status').then((r) => r.json()).then((s) => s.ai).catch(() => false);
  return aiStatus;
}

// task: 'invoice' | 'sales' | 'bottle'
export async function readWithAI(task, blobs, context = {}) {
  const images = await Promise.all(blobs.map(async (b) => ({ mediaType: b.type || 'image/jpeg', data: await toBase64(b) })));
  const res = await fetch(`/api/read/${task}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, context }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Photo reading failed (${res.status})`);
  return body;
}
