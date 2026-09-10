/**
 * Генерация примера тир-листа: examples/demo-tier-list.json
 * Запуск: node scripts/make-example.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDefaultState, MODE_SUM, uid } from '../src/js/constants.js';
import { exportPayload } from '../src/js/serialize.js';
import { Store } from '../src/js/store.js';
import { placeholderDataUrl } from '../src/js/sample-image.js';
import { evenZoneRanges, globalRange, snapToStep } from '../src/js/scoring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ITEMS = [
  ['Экскалибур', 1.0],
  ['Клинок рассвета', 0.92],
  ['Щит титана', 0.84],
  ['Лук ветра', 0.76],
  ['Посох огня', 0.68],
  ['Зелье силы', 0.6],
  ['Сапоги-скороходы', 0.52],
  ['Шлем стража', 0.44],
  ['Амулет удачи', 0.36],
  ['Книга заклинаний', 0.28],
  ['Молот грома', 0.2],
  ['Ржавый меч', 0.1],
];

const state = createDefaultState();
state.title = 'Пример: лучшее снаряжение';
state.mode = MODE_SUM;
state.zones = state.zones.map((zone, i) => ({ ...zone, name: ['S', 'A', 'B', 'C', 'D'][i] }));

const store = new Store(state);
store.update((s) => {
  const range = globalRange(s);
  s.zones = evenZoneRanges(s.zones, range);
  s.range = { min: range.min, max: range.max };
});

const scales = store.state.scales;
ITEMS.forEach(([text, power], index) => {
  store.update((s) => {
    const item = {
      id: uid('item'),
      text,
      image: placeholderDataUrl({ label: text.split(' ')[0], seed: index * 41 + 7 }),
      scores: {},
      frozen: {},
      order: index,
      zoneId: s.zones[s.zones.length - 1].id,
      manual: false,
    };
    for (const scale of s.scales) {
      const raw = scale.min + (scale.max - scale.min) * power;
      item.scores[scale.id] = snapToStep(raw, scale);
    }
    s.items.push(item);
  });
});

// одна замороженная шкала — чтобы было видно, как работает заморозка
store.toggleFrozen(store.state.items[5].id, scales[2].id);

const payload = exportPayload(store.state);
const out = path.join(ROOT, 'examples', 'demo-tier-list.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`Готово: ${path.relative(ROOT, out)} (${kb} КБ)`);
console.log(`Зон: ${payload.zones.length}, шкал: ${payload.scales.length}, элементов: ${payload.items.length}`);
console.log('Зоны:', payload.zones.map((z) => `${z.name} ${z.min}…${z.max} (${z.items.length})`).join(' | '));
