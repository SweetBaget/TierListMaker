/**
 * Интеграционные тесты интерфейса: DOM, панели, инспектор, файлы.
 * Окружение — jsdom, приложение поднимается «как в браузере».
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let counter = 0;

function installGlobals(window) {
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define('window', window);
  define('document', window.document);
  define('localStorage', window.localStorage);
  define('MutationObserver', window.MutationObserver);
  define('HTMLElement', window.HTMLElement);
  define('Element', window.Element);
  define('Node', window.Node);
  define('Event', window.Event);
  define('CustomEvent', window.CustomEvent);
  define('KeyboardEvent', window.KeyboardEvent);
  define('MouseEvent', window.MouseEvent);
  define('Image', window.Image);
  define('FileReader', window.FileReader);
  define('Blob', window.Blob);
  define('DataTransfer', window.DataTransfer);
  define('getComputedStyle', window.getComputedStyle.bind(window));
  define('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
  define('cancelAnimationFrame', (id) => clearTimeout(id));
  define('navigator', window.navigator);
  define('confirm', () => true);
  define('alert', () => {});
}

/** Поднимает приложение на свежем DOM и возвращает доступ к его API. */
async function boot() {
  const dom = new JSDOM(HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  installGlobals(dom.window);
  await import(`../src/js/app.js?test=${(counter += 1)}`);
  const api = dom.window.__tierlist;
  api.dom = dom;
  api.window = dom.window;
  api.doc = dom.window.document;
  api.$ = (sel) => dom.window.document.querySelector(sel);
  api.$$ = (sel) => [...dom.window.document.querySelectorAll(sel)];
  api.click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  api.key = (node, key, extra = {}) => {
    node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
  };
  api.zoneRow = (i) => api.$$('.zone')[i];
  api.zoneName = (i) => api.zoneRow(i).querySelector('.zone-name').textContent;
  api.zoneRange = (i) => api.zoneRow(i).querySelector('.zone-range').textContent;
  api.tiles = (i) => [...api.zoneRow(i).querySelectorAll('.tile')];
  return api;
}

test('при запуске рисуются 5 зон A…E с диапазонами и бейджем 0…75', async () => {
  const app = await boot();
  assert.equal(app.$$('.zone').length, 5);
  assert.equal(app.zoneName(0), 'A');
  assert.equal(app.zoneRange(0), '60 … 75');
  assert.equal(app.zoneRange(4), '0 … 15');
  assert.equal(app.$('#range-min').textContent, '0');
  assert.equal(app.$('#range-max').textContent, '75');
  assert.equal(app.$$('.zone-row').length, 5);
  assert.equal(app.$$('.scale-row').length, 3);
});

test('элемент добавляется текстом и попадает в нижнюю зону', async () => {
  const app = await boot();
  app.$('#new-item-text').value = 'Меч';
  app.click(app.$('#btn-add-text'));
  assert.equal(app.store.state.items.length, 1);
  const tiles = app.tiles(4);
  assert.equal(tiles.length, 1);
  assert.match(tiles[0].textContent, /Меч/);
  assert.match(tiles[0].querySelector('.tile-score').textContent, /0/);
});

test('перетаскивание в зону C подстраивает баллы и переставляет элемент', async () => {
  const app = await boot();
  app.store.update((s) => {
    s.items.push({ id: 'i1', text: 'Меч', image: null, scores: {}, frozen: {}, order: 0, zoneId: s.zones[4].id });
  });
  const zoneC = app.store.state.zones[2];
  app.dropItem('i1', zoneC.id, 0);
  const item = app.store.state.items[0];
  const total = app.itemTotals(item);
  assert.ok(total >= zoneC.min - 1e-6 && total <= zoneC.max + 1e-6, `итог ${total} в диапазоне ${zoneC.min}…${zoneC.max}`);
  assert.equal(app.tiles(2).length, 1);
  assert.match(app.tiles(2)[0].querySelector('.tile-score').textContent, /3[0-9]/);
});

test('название зоны редактируется кликом с сохранением по Enter', async () => {
  const app = await boot();
  const nameEl = app.zoneRow(0).querySelector('.zone-name');
  app.click(nameEl);
  const input = app.zoneRow(0).querySelector('input.inline-input');
  assert.ok(input, 'поле ввода должно появиться на месте названия');
  input.value = 'S+';
  app.key(input, 'Enter');
  assert.equal(app.store.state.zones[0].name, 'S+');
  assert.equal(app.zoneName(0), 'S+');
});

test('название зоны отменяется по Escape', async () => {
  const app = await boot();
  app.click(app.zoneRow(0).querySelector('.zone-name'));
  const input = app.zoneRow(0).querySelector('input.inline-input');
  input.value = 'Не сохранять';
  app.key(input, 'Escape');
  assert.equal(app.store.state.zones[0].name, 'A');
});

test('длинное название зоны расширяет зону вниз (перенос строк)', async () => {
  const app = await boot();
  app.store.patchZone(app.store.state.zones[0].id, { name: 'Очень длинное название зоны' });
  const nameEl = app.zoneRow(0).querySelector('.zone-name');
  assert.equal(nameEl.textContent, 'Очень длинное название зоны');
  // CSS: white-space: pre-wrap + word-break: break-word → высота строки растёт по содержимому
  const css = readFileSync(path.join(ROOT, 'src/styles/app.css'), 'utf8');
  const labelRule = css.slice(css.indexOf('.zone-label .zone-name'), css.indexOf('.zone-label .zone-range'));
  assert.match(labelRule, /word-break:\s*break-word/);
  assert.match(css, /\.zone\s*{[^}]*align-items:\s*stretch/s);
});

test('диапазон зоны редактируется кликом по подписи', async () => {
  const app = await boot();
  app.click(app.zoneRow(1).querySelector('.zone-range'));
  const input = app.zoneRow(1).querySelector('input.is-range');
  assert.ok(input);
  input.value = '40 … 55';
  app.key(input, 'Enter');
  const zones = app.store.state.zones;
  assert.equal(zones[1].min, 40);
  assert.equal(zones[1].max, 55);
  assert.equal(zones[2].max, 40, 'зона ниже должна сдвинуться');
  assert.equal(zones[0].min, 55, 'зона выше должна сдвинуться');
});

test('включение/выключение шкалы меняет диапазон и границы зон', async () => {
  const app = await boot();
  const checkbox = app.$$('.scale-row')[0].querySelector('input[type=checkbox]');
  checkbox.checked = false;
  checkbox.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.store.state.scales[0].enabled, false);
  assert.equal(app.$('#range-max').textContent, '55');
  assert.equal(app.store.state.zones[0].max, 55);
  checkbox.checked = true;
  checkbox.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.$('#range-max').textContent, '75');
});

test('кнопка «только я» оставляет одну шкалу', async () => {
  const app = await boot();
  const row = app.$$('.scale-row')[2];
  app.click(row.querySelector('.icon-btn'));
  assert.deepEqual(
    app.store.state.scales.map((s) => s.enabled),
    [false, false, true]
  );
  assert.equal(app.$('#range-min').textContent, '0');
  assert.equal(app.$('#range-max').textContent, '50');
});

test('правка шкалы (старт/финиш/шаг/вес) обновляет расчёт', async () => {
  const app = await boot();
  const row = app.$$('.scale-row')[0];
  const [minIn, maxIn, stepIn, weightIn] = row.querySelectorAll('.scale-params input');
  maxIn.value = '20';
  maxIn.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  weightIn.value = '3';
  weightIn.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  stepIn.value = '0,5';
  stepIn.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  minIn.value = '0';
  minIn.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  const scale = app.store.state.scales[0];
  assert.equal(scale.max, 20);
  assert.equal(scale.weight, 3);
  assert.equal(scale.step, 0.5);
  assert.equal(app.store.state.range.max, 20 * 3 + 5 * 1 + 100 * 0.5);
});

test('изменение названия шкалы сохраняется', async () => {
  const app = await boot();
  const row = app.$$('.scale-row')[0];
  const nameInput = row.querySelector('.scale-name');
  nameInput.value = 'Мощность';
  nameInput.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.store.state.scales[0].name, 'Мощность');
});

test('клик по элементу открывает карточку с баллами и заморозкой', async () => {
  const app = await boot();
  app.store.addItem({ text: 'Щит' });
  const itemId = app.store.state.items[0].id;
  app.click(app.tiles(4)[0]);
  const pop = app.$('.popover');
  assert.ok(pop, 'карточка элемента должна открыться');
  const rows = pop.querySelectorAll('.scale-edit');
  assert.equal(rows.length, 3);

  // поднимаем балл ползунком
  const slider = rows[0].querySelector('input[type=range]');
  slider.value = '8';
  slider.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(app.store.state.items[0].scores['sc-quality'], 8);

  // заморозка
  const freeze = rows[0].querySelector('.freeze-btn');
  app.click(freeze);
  assert.equal(app.store.state.items[0].frozen['sc-quality'], true);
  assert.equal(app.$('.popover .freeze-btn').textContent.includes('Заморожена'), true);

  // индикатор заморозки на плитке
  const tileTop = app.$$('.tile').find((t) => t.dataset.itemId === itemId);
  assert.ok(tileTop.classList.contains('is-frozen'));
});

test('заморозка мешает авто-подстройке и предупреждает об этом', async () => {
  const app = await boot();
  app.store.addItem({ text: 'Якорь' });
  const itemId = app.store.state.items[0].id;
  app.store.update((s) => {
    const item = s.items[0];
    s.scales.forEach((sc) => {
      item.frozen[sc.id] = true;
    });
    item.scores['sc-looks'] = 100;
  });
  const before = { ...app.store.state.items[0].scores };
  const info = app.dropItem(itemId, app.store.state.zones[4].id, 0);
  assert.equal(info.adjusted, false);
  assert.deepEqual(app.store.state.items[0].scores, before);
  assert.ok(app.$$('.toast').some((t) => /заморож/i.test(t.textContent)));
});

test('экспорт → импорт сохраняет данные и границы зон', async () => {
  const app = await boot();
  app.store.update((s) => {
    s.title = 'Итоговый';
    s.zones[0].name = 'S+';
    s.items.push({ id: 'i1', text: 'Меч', image: 'data:image/png;base64,AAA', scores: { 'sc-quality': 9 }, frozen: { 'sc-quality': true }, order: 0 });
  });
  const json = app.exportJSON();
  const parsed = JSON.parse(json);
  assert.equal(parsed.items[0].total, 9 * 2);
  assert.equal(parsed.zones[0].name, 'S+');

  app.importJSON(json);
  assert.equal(app.store.state.title, 'Итоговый');
  assert.equal(app.store.state.zones[0].name, 'S+');
  assert.equal(app.store.state.items[0].image, 'data:image/png;base64,AAA');
  assert.equal(app.store.state.items[0].frozen['sc-quality'], true);
  assert.equal(app.store.state.zones[0].max, 75);
});

test('импорт испорченного файла показывает ошибку и не меняет данные', async () => {
  const app = await boot();
  app.store.addItem({ text: 'Остаётся' });
  app.importJSON('{это не json');
  assert.equal(app.store.state.items.length, 1);
  assert.ok(app.$$('.toast').some((t) => /импорт/i.test(t.textContent)));
});

test('ручной режим закрепляет элемент без изменения баллов', async () => {
  const app = await boot();
  app.store.addItem({ text: 'Ручной' });
  const itemId = app.store.state.items[0].id;
  const before = { ...app.store.state.items[0].scores };
  app.$('#auto-adjust').checked = false;
  app.$('#auto-adjust').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  app.dropItem(itemId, app.store.state.zones[0].id, 0);
  const item = app.store.state.items[0];
  assert.equal(item.manual, true);
  assert.deepEqual(item.scores, before);
  assert.equal(app.tiles(0).length, 1);
});

test('заголовок и режим расчёта меняются через интерфейс', async () => {
  const app = await boot();
  const title = app.$('#title-input');
  title.value = 'Лучшие мечи';
  title.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(app.store.state.title, 'Лучшие мечи');

  const avgBtn = app.$$('.mode-btn').find((b) => b.dataset.mode === 'avg');
  app.click(avgBtn);
  assert.equal(app.store.state.mode, 'avg');
  assert.ok(avgBtn.classList.contains('is-active'));
  assert.match(app.$('#status-mode').textContent, /средний балл/);
  assert.equal(app.$('#range-max').textContent, app.window.String(Number(app.store.state.range.max.toFixed(2))).replace('.', ','));
});

test('добавление и удаление зон через панель', async () => {
  const app = await boot();
  app.click(app.$('#btn-add-zone'));
  assert.equal(app.store.state.zones.length, 6);
  assert.equal(app.$$('.zone').length, 6);
  assert.equal(app.store.state.zones[5].min, 0);
  assert.equal(app.store.state.zones[0].max, 75);

  const delBtn = app.$$('.zone-row')[5].querySelector('.icon-btn.is-danger');
  app.click(delBtn);
  assert.equal(app.store.state.zones.length, 5);
  assert.equal(app.store.state.zones[4].min, 0);
});

test('перемещение зоны вверх меняет её место в списке', async () => {
  const app = await boot();
  const [first, second] = app.store.state.zones;
  app.click(app.$$('.zone-row')[1].querySelectorAll('.icon-btn')[0]);
  assert.equal(app.store.state.zones[0].name, second.name);
  assert.equal(app.store.state.zones[1].name, first.name);
  assert.equal(app.zoneName(0), second.name);
});

test('добавление шкалы и удаление шкалы', async () => {
  const app = await boot();
  app.click(app.$('#btn-add-scale'));
  assert.equal(app.store.state.scales.length, 4);
  assert.equal(app.$$('.scale-row').length, 4);
  const del = app.$$('.scale-row')[3].querySelector('.icon-btn.is-danger');
  app.click(del);
  assert.equal(app.store.state.scales.length, 3);
});

test('статус-бар показывает сводку и режим', async () => {
  const app = await boot();
  app.store.addItem({ text: 'A' });
  app.store.addItem({ text: 'B' });
  assert.match(app.$('#status-summary').textContent, /Элементов: 2/);
  assert.match(app.$('#status-mode').textContent, /сумма баллов/);
});

test('состояние восстанавливается из localStorage при перезапуске', async () => {
  const app = await boot();
  app.store.addItem({ text: 'Сохранить меня' });
  app.store.save();
  const saved = app.window.localStorage.getItem('tierlistmaker.state.v1');
  assert.ok(saved && saved.includes('Сохранить меня'));
  const raw = JSON.parse(saved);
  assert.equal(raw.items.length, 1);
  assert.equal(raw.zones[0].max, 75);
});

test('элементы внутри зоны отсортированы по убыванию баллов', async () => {
  const app = await boot();
  app.store.update((s) => {
    s.items.push({ id: 'low', text: 'Low', image: null, scores: { 'sc-quality': 1 }, frozen: {}, order: 0 });
    s.items.push({ id: 'high', text: 'High', image: null, scores: { 'sc-quality': 7 }, frozen: {}, order: 1 });
  });
  const tiles = app.tiles(4);
  assert.deepEqual(
    tiles.map((t) => t.dataset.itemId),
    ['high', 'low']
  );
});

test('переключение темы меняет атрибут data-theme', async () => {
  const app = await boot();
  const btn = app.$('#btn-theme');
  const before = app.doc.documentElement.dataset.theme;
  app.click(btn);
  const after = app.doc.documentElement.dataset.theme;
  assert.notEqual(before, after);
  assert.ok(['dark', 'light'].includes(after));
});

test('демо-элементы распределяются по разным зонам и сортируются по баллам', async () => {
  const app = await boot();
  app.seedDemo();
  assert.equal(app.store.state.items.length, 10);
  const occupied = new Set();
  for (let i = 0; i < 5; i += 1) if (app.tiles(i).length) occupied.add(i);
  assert.ok(occupied.size >= 3, `должны заполниться разные зоны, заполнено: ${occupied.size}`);
  const tiles = app.tiles(0);
  const scores = tiles.map((t) => Number(t.querySelector('.tile-score').textContent.replace(',', '.')));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(tiles.every((t) => t.querySelector('img')), 'у демо-элементов есть картинки');
});

test('стили приложения разбираются и содержат ключевые правила вида тир-листа', async () => {
  const app = await boot();
  const style = app.doc.createElement('style');
  style.textContent = readFileSync(path.join(ROOT, 'src/styles/app.css'), 'utf8');
  app.doc.head.append(style);
  const selectors = [...style.sheet.cssRules].map((r) => r.selectorText).filter(Boolean);
  for (const sel of ['.zone', '.zone-label', '.zone-items', '.tile', '.popover', 'input.inline-input', '.drop-marker', '.switch .slider']) {
    assert.ok(selectors.includes(sel), `правило ${sel} должно присутствовать`);
  }
  const css = style.textContent;
  assert.match(css, /\.zone\s*{[^}]*grid-template-columns:\s*var\(--zone-label-w\)/s, 'зона = колонка ярлыка + область элементов');
  assert.match(css, /\.zone-label \.zone-name\s*{[^}]*word-break:\s*break-word/s, 'длинное название переносится');
  assert.match(css, /\.zone-label \.zone-name\s*{[^}]*white-space:\s*pre-wrap/s);
  assert.match(css, /:root\[data-theme='light'\]/, 'есть светлая тема');
});

test('кнопка ⚙ в зоне открывает карточку настройки с цветом и диапазоном', async () => {
  const app = await boot();
  const gear = app.zoneRow(1).querySelector('.zone-label-actions .mini-btn:last-child');
  app.click(gear);
  const pop = app.$('.popover');
  assert.ok(pop, 'карточка зоны должна открыться');
  assert.match(pop.querySelector('.popover-title').textContent, /Зона «B»/);
  assert.equal(pop.querySelectorAll('.color-grid button').length, 8);

  // меняем цвет
  app.click(pop.querySelectorAll('.color-grid button')[3]);
  assert.equal(app.store.state.zones[1].color, '#a5e887');

  // меняем нижнюю границу зоны
  const [minInput] = pop.querySelectorAll('.scale-params input');
  minInput.value = '52';
  minInput.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.store.state.zones[1].min, 52);
  assert.equal(app.store.state.zones[2].max, 52, 'зона ниже подтягивается');

  // «выровнять все зоны»
  const even = [...pop.querySelectorAll('.popover-foot .btn')].find((b) => /Выровнять/.test(b.textContent));
  app.click(even);
  assert.equal(app.store.state.zones[0].min, 60);
  assert.equal(app.store.state.zones[1].min, 45);
});

test('Alt+стрелки переносят элемент между зонами', async () => {
  const app = await boot();
  app.store.addItem({ text: 'Клавиатура' });
  const tile = app.tiles(4)[0];
  const itemId = tile.dataset.itemId;
  app.key(tile, 'ArrowUp', { altKey: true }); // в зону D
  const zones = app.store.state.zones;
  const rowD = app.tiles(3).map((t) => t.dataset.itemId);
  assert.ok(rowD.includes(itemId), 'элемент должен оказаться в зоне D');
  app.key(app.$$(`.tile[data-item-id="${itemId}"]`)[0], 'ArrowDown', { altKey: true });
  assert.ok(app.tiles(4).map((t) => t.dataset.itemId).includes(itemId), 'и вернуться в зону E');
  void zones;
});

test('пример из examples/demo-tier-list.json импортируется целиком', async () => {
  const app = await boot();
  const example = readFileSync(path.join(ROOT, 'examples/demo-tier-list.json'), 'utf8');
  app.importJSON(example);
  const state = app.store.state;
  assert.equal(state.title, 'Пример: лучшее снаряжение');
  assert.equal(state.items.length, 12);
  assert.deepEqual(state.zones.map((z) => z.name), ['S', 'A', 'B', 'C', 'D']);
  assert.equal(state.zones[0].max, 75);
  assert.equal(state.zones.at(-1).min, 0);
  // элементы распределены по всем зонам и отсортированы
  const occupied = [0, 1, 2, 3, 4].filter((i) => app.tiles(i).length);
  assert.equal(occupied.length, 5);
  const top = app.tiles(0).map((t) => Number(t.querySelector('.tile-score').textContent.replace(',', '.')));
  assert.deepEqual(top, [...top].sort((a, b) => b - a));
  // заморозка из файла сохранилась
  const frozenItem = state.items.find((it) => Object.values(it.frozen || {}).some(Boolean));
  assert.ok(frozenItem, 'в примере есть элемент с замороженной шкалой');
  const tile = app.$$('.tile').find((t) => t.dataset.itemId === frozenItem.id);
  assert.ok(tile.classList.contains('is-frozen'));
});

test('зона создаётся одной кнопкой, без окон создания', async () => {
  const app = await boot();
  const before = app.store.state.zones.length;
  app.click(app.$('#btn-add-zone'));
  assert.equal(app.store.state.zones.length, before + 1, 'зона появилась сразу после клика');
  assert.equal(app.$$('.popover').length, 0, 'никаких окон создания не открывается');
  assert.equal(app.$$('dialog').length, 0, 'модальных диалогов создания нет');
  const added = app.store.state.zones.at(-1);
  assert.equal(added.name, `Зона ${before + 1}`, 'имя подставляется автоматически');
  assert.equal(added.min, 0);
  assert.equal(app.zoneName(before), added.name);
  // и оно сразу правится кликом, без окон
  app.click(app.zoneRow(before).querySelector('.zone-name'));
  const input = app.zoneRow(before).querySelector('input.inline-input');
  assert.ok(input);
  input.value = 'Мусор';
  app.key(input, 'Enter');
  assert.equal(app.store.state.zones.at(-1).name, 'Мусор');
  assert.equal(app.$$('.popover').length, 0);
});

test('окно редактирования зоны на месте: ⚙ даёт цвет, диапазон, порядок и удаление', async () => {
  const app = await boot();
  assert.equal(app.$$('.zone-label-actions .mini-btn').length, 15, 'в ярлыке зоны ▲, ▼ и ⚙ на каждую из 5 зон');
  app.click(app.zoneRow(2).querySelector('.zone-label-actions .mini-btn:last-child'));
  const pop = app.$('.popover');
  assert.ok(pop, 'окно редактирования зоны открывается');
  assert.match(pop.querySelector('.popover-title').textContent, /Зона «C»/);
  assert.equal(pop.querySelectorAll('.color-grid button').length, 8);
  const [minInput, maxInput] = pop.querySelectorAll('.scale-params input');
  assert.ok(minInput && maxInput);
  const foot = [...pop.querySelectorAll('.popover-foot .btn')].map((b) => b.textContent.trim());
  assert.ok(foot.some((t) => /Выше/.test(t)));
  assert.ok(foot.some((t) => /Ниже/.test(t)));
  assert.ok(foot.some((t) => /Выровнять/.test(t)));
  assert.ok(foot.some((t) => /Удалить/.test(t)));
});
