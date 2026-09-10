/**
 * Процедурная генерация картинок-заготовок для элементов (без обращения к сети).
 * Возвращает data URL в формате SVG.
 */

const PALETTES = [
  ['#ff8a8a', '#c0392b'],
  ['#ffc078', '#e17055'],
  ['#ffe066', '#f0932b'],
  ['#a5e887', '#27ae60'],
  ['#7fd1ff', '#2980b9'],
  ['#b7a5ff', '#6c5ce7'],
  ['#ff9fd6', '#c2185b'],
  ['#8ff0d6', '#00a3a3'],
];

const TITLE_SEEDS = ['Новый', 'Тир', 'Элемент', 'Балл'];

/** Утилита: экранирование текста в SVG. */
export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Универсальная заготовка: градиент, узор и подпись. */
export function placeholderDataUrl(options = {}) {
  const { label = '', seed = Math.floor(Math.random() * 1e6), size = 256 } = options;
  const palette = PALETTES[seed % PALETTES.length];
  const [c1, c2] = palette;
  const rings = 3 + (seed % 3);
  const text = (label || TITLE_SEEDS[seed % TITLE_SEEDS.length] || 'Элемент').slice(0, 18);
  const fontSize = text.length > 12 ? 30 : text.length > 8 ? 38 : 46;
  const circles = Array.from({ length: rings }, (_, i) => {
    const r = 40 + i * 34 + (seed % 20);
    return `<circle cx="${60 + ((seed * (i + 3)) % 140)}" cy="${60 + ((seed * (i + 5)) % 140)}" r="${r}" fill="rgba(255,255,255,0.10)"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="24" fill="url(#g)"/>
  ${circles}
  <text x="128" y="${140}" text-anchor="middle" font-family="Segoe UI, Roboto, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" opacity="0.95">${esc(text)}</text>
  <text x="128" y="${196}" text-anchor="middle" font-family="Segoe UI, Roboto, sans-serif" font-size="20" fill="#ffffff" opacity="0.6">#${seed % 1000}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Эмодзи-картинка (крупный символ на прозрачном фоне). */
export function emojiDataUrl(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <text x="128" y="188" text-anchor="middle" font-size="180" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">${esc(emoji)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const EMOJI_SET = ['🔥', '💧', '🌿', '⚡', '❄️', '🌙', '⭐', '🍀', '🗡️', '🛡️', '🎯', '🧪', '🎲', '👑', '🐉', '🦊'];
