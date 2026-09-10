/**
 * Работа с файлами. Внутри Electron используем системные диалоги,
 * в браузере (режим разработки) — обычные <input type=file> и скачивание.
 * API всегда работает со строками (data URL), поэтому логика приложения не зависит от среды.
 */

const isElectron = () => typeof window !== 'undefined' && Boolean(window.tierlist?.isElectron);

export const inElectron = isElectron;

/** Сохранить текст (JSON) в файл. Возвращает { ok, canceled, path|error }. */
export async function saveTextFile({ suggestedName, content, filters, title }) {
  if (isElectron()) {
    return window.tierlist.saveTextFile({ suggestedName, content, filters, title });
  }
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { ok: true };
}

/** Открыть JSON-файл и вернуть его содержимое строкой. */
export async function openTextFile({ filters, title } = {}) {
  if (isElectron()) {
    return window.tierlist.openTextFile({ filters, title });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('cancel', () => resolve({ canceled: true }));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ canceled: true });
      const text = await file.text();
      resolve({ ok: true, content: text, path: file.name });
    });
    input.click();
  });
}

/** Выбрать изображение и вернуть его как data URL. */
export async function pickImage() {
  if (isElectron()) {
    return window.tierlist.pickImage();
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('cancel', () => resolve({ canceled: true }));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ canceled: true });
      const dataUrl = await readFileAsDataURL(file);
      resolve({ ok: true, dataUrl, path: file.name });
    });
    input.click();
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ------------------------- картинки: сжатие и вставка ------------------------- */

/** Уменьшение картинки до maxSide и пересохранение в PNG/JPEG (чтобы JSON не разрастался). */
export async function downscaleDataUrl(dataUrl, maxSide = 512, quality = 0.92) {
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    if (scale >= 1 && dataUrl.length < 200000) return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
    const w = Math.max(1, Math.round((img.naturalWidth || maxSide) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || maxSide) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const hasAlpha = /^data:image\/(png|webp|gif)/i.test(dataUrl);
    const out = hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
    return { dataUrl: out.length < dataUrl.length ? out : dataUrl, width: w, height: h };
  } catch {
    return { dataUrl, width: 0, height: 0 };
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = src;
  });
}

/** Извлечение картинки из буфера обмена (Ctrl+V / контекстное меню). */
export async function imageFromClipboard(clipboardData) {
  const items = clipboardData?.items || [];
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return readFileAsDataURL(file);
    }
  }
  const files = clipboardData?.files || [];
  for (const file of files) {
    if (file.type && file.type.startsWith('image/')) return readFileAsDataURL(file);
  }
  return null;
}

/** Скачивание data URL (для браузерного режима). */
export function downloadDataUrl(dataUrl, fileName) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
