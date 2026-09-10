/**
 * Точка входа приложения: связывает состояние, панели, файлы и горячие клавиши.
 */

import { MODE_AVG, MODE_SUM, uid } from './constants.js';
import { downscaleDataUrl, imageFromClipboard, openTextFile, pickImage, readFileAsDataURL, saveTextFile } from './files.js';
import { EMOJI_SET, emojiDataUrl, placeholderDataUrl } from './sample-image.js';
import { activeScales, globalRange, itemTotal, layout, snapToStep, zoneForItem } from './scoring.js';
import { exportFileName, exportJSON, parseImported } from './serialize.js';
import { Store } from './store.js';
import { Board, tooltipFor } from './ui/board.js';
import { $, el, fmt, isTypingTarget, openPopover, plural, scrollIntoViewIfNeeded, toast } from './ui/dom.js';
import { openItemInspector } from './ui/itemInspector.js';
import { ScalePanel } from './ui/scales.js';
import { ZonePanel } from './ui/zones.js';

const store = new Store(Store.load());
let board;
let zonePanel;
let scalePanel;
let inspector = null;
let saveTimer = null;

let theme = Store.loadTheme();

/* ============================== запуск ============================== */

function init() {
  applyTheme(theme);

  board = new Board($('#board'), {
    onDropItem: (itemId, zoneId, index) => handleDrop(itemId, zoneId, index, { quiet: true }),
    onOpenItem: (itemId, anchor) => openInspector(itemId, anchor),
    onPatchZone: (zoneId, patch) => store.patchZone(zoneId, patch),
    onMoveZone: (zoneId, dir) => store.moveZone(zoneId, dir),
    isSelected: (itemId) => inspector?.itemId === itemId,
    onKeyMove: (itemId, dir) => moveByKeyboard(itemId, dir),
  });
  zonePanel = new ZonePanel($('#zone-list'), store);
  scalePanel = new ScalePanel($('#scale-list'), store);

  wireToolbar();
  wireAddBar();
  wireStatusBar();
  wireShortcuts();
  wireFileDrop();

  // пункты меню Electron (Файл → Новый/Импорт/Экспорт)
  window.tierlist?.onMenuAction?.((action) => {
    if (action === 'new') newList();
    else if (action === 'import') importDialog();
    else if (action === 'export') exportFile();
  });

  store.subscribe(render);
  render(store.state);
  store.save();

  // приветственная подсказка при первом запуске
  if (!store.state.items.length) {
    setTimeout(() => toast('Добавьте элемент текстом или картинкой — и перетащите его в нужную зону', 'info', 7000), 600);
  }
  window.addEventListener('beforeunload', () => store.save());
}

/** Полная перерисовка интерфейса. */
function render(state) {
  board.render(state);
  zonePanel.render(state);
  scalePanel.render(state);
  renderToolbar(state);
  renderStatus(state);
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.save(), 350);
}

/* ============================== тема ============================== */

function applyTheme(next) {
  theme = next === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  const btn = $('#btn-theme');
  if (btn) {
    btn.textContent = theme === 'light' ? '☀️' : '🌙';
    btn.title = theme === 'light' ? 'Переключить на тёмную тему' : 'Переключить на светлую тему';
  }
  Store.saveTheme(theme);
}

/* ============================== панель инструментов ============================== */

function wireToolbar() {
  const title = $('#title-input');
  title.addEventListener('input', (ev) => store.setTitle(ev.currentTarget.value));

  $('#btn-theme').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
  $('#btn-new').addEventListener('click', newList);
  $('#btn-import').addEventListener('click', importDialog);
  $('#btn-export').addEventListener('click', exportFile);
  $('#btn-add-zone').addEventListener('click', () => {
    store.addZone(`Зона ${store.state.zones.length + 1}`);
    toast('Зона добавлена снизу', 'info');
  });
  $('#btn-add-scale').addEventListener('click', () => {
    store.addScale();
    toast('Шкала добавлена', 'info');
  });

  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.addEventListener('click', () => {
      store.setMode(btn.dataset.mode);
      const mode = btn.dataset.mode;
      toast(
        mode === MODE_SUM
          ? 'Итог = сумма баллов по включённым шкалам с учётом весов'
          : 'Итог = средний балл по включённым шкалам с учётом весов',
        'info'
      );
    });
  }
}

function renderToolbar(state) {
  const title = $('#title-input');
  if (document.activeElement !== title) title.value = state.title;
  const range = globalRange(state);
  $('#range-min').textContent = fmt(range.min, 2);
  $('#range-max').textContent = fmt(range.max, 2);
  const badge = $('#range-badge');
  const scales = activeScales(state);
  badge.title = scales.length
    ? `Диапазон баллов по ${scales.length} ${plural(scales.length, 'включённой шкале', 'включённым шкалам', 'включённым шкалам')}: ${fmt(range.min, 2)} … ${fmt(range.max, 2)}`
    : 'Нет включённых шкал — положение элементов задаётся вручную';
  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.classList.toggle('is-active', btn.dataset.mode === state.mode);
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
  }
}

function wireStatusBar() {
  const check = $('#auto-adjust');
  check.addEventListener('change', (ev) => {
    store.setAutoAdjust(ev.currentTarget.checked);
    toast(
      ev.currentTarget.checked
        ? 'Авто-подстройка включена: при перемещении баллы подстраиваются под позицию'
        : 'Авто-подстройка выключена: элементы закрепляются вручную, баллы не меняются',
      'info'
    );
  });
}

function renderStatus(state) {
  const check = $('#auto-adjust');
  if (check.checked !== state.autoAdjust) check.checked = state.autoAdjust;
  $('#status-mode').textContent = `Расчёт: ${state.mode === MODE_AVG ? 'средний балл' : 'сумма баллов'}`;
  const scales = activeScales(state);
  $('#status-summary').textContent = `Элементов: ${state.items.length} · Зон: ${state.zones.length} · Шкал: ${state.scales.length} (включено ${scales.length})`;
  const hint = $('#status-hint');
  hint.textContent = store.state.autoAdjust
    ? 'Перетащите элемент в нужную зону — баллы подстроятся автоматически'
    : 'Ручной режим: элемент останется в выбранной зоне, баллы не изменятся';
}

/* ============================== добавление элементов ============================== */

function wireAddBar() {
  const input = $('#new-item-text');
  const addText = () => {
    const text = input.value.trim();
    if (!text) {
      toast('Введите название элемента', 'warn');
      input.focus();
      return;
    }
    store.addItem({ text });
    input.value = '';
    input.focus();
  };
  $('#btn-add-text').addEventListener('click', addText);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') addText();
  });
  $('#btn-add-image').addEventListener('click', addImageItem);
  $('#btn-add-emoji').addEventListener('click', (ev) => openAssetsPopover(ev.currentTarget));
}

async function addImageItem() {
  const res = await pickImage();
  if (!res || res.canceled) return;
  if (!res.ok) {
    toast(res.error || 'Не удалось прочитать файл', 'error');
    return;
  }
  const { dataUrl } = await downscaleDataUrl(res.dataUrl, 512);
  store.addItem({ text: '', image: dataUrl });
  toast('Элемент с картинкой добавлен', 'good');
}

function openAssetsPopover(anchor) {
  const nameInput = $('#new-item-text');
  const emojis = el(
    'div',
    { class: 'emoji-grid' },
    EMOJI_SET.map((emoji) =>
      el('button', {
        type: 'button',
        textContent: emoji,
        title: `Добавить элемент «${emoji}»`,
        onclick: () => {
          store.addItem({ image: emojiDataUrl(emoji), text: nameInput.value.trim() });
          nameInput.value = '';
        },
      })
    )
  );
  const generate = () => {
    const label = nameInput.value.trim();
    store.addItem({ image: placeholderDataUrl({ label }), text: label });
    nameInput.value = '';
  };
  const content = el('div', {}, [
    el('div', { class: 'popover-head' }, [el('div', { class: 'popover-title' }, ['Быстрые заготовки'])]),
    el('p', { class: 'card-note' }, [
      'Эмодзи и сгенерированные картинки не требуют файлов — они хранятся прямо в JSON как SVG. В названии можно использовать текст из поля ввода.',
    ]),
    el('div', { class: 'field' }, [el('span', {}, ['Эмодзи']), emojis]),
    el('div', { class: 'popover-foot' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        textContent: '🎨 Сгенерировать картинку-заготовку',
        onclick: generate,
      }),
      el('button', {
        class: 'btn',
        type: 'button',
        textContent: '🎬 Заполнить демо-элементами',
        title: 'Добавить 10 примеров, равномерно распределённых по зонам',
        onclick: (ev) => {
          seedDemo();
          ev.currentTarget.closest('.popover')?.remove();
        },
      }),
    ]),
  ]);
  openPopover({ anchor, content, width: 340 });
}

/** Наполняет тир-лист демонстрационными элементами. */
function seedDemo() {
  const labels = ['Меч', 'Щит', 'Лук', 'Зелье', 'Книга', 'Сапоги', 'Шлем', 'Посох', 'Амулет', 'Молот'];
  store.update((s) => {
    const scales = activeScales(s);
    labels.forEach((label, i) => {
      const power = (i + 1) / (labels.length + 1);
      const item = {
        id: uid('item'),
        text: label,
        image: placeholderDataUrl({ label, seed: i * 37 + 5 }),
        scores: {},
        frozen: {},
        order: s.items.length + i,
        zoneId: s.zones[s.zones.length - 1].id,
        manual: false,
      };
      for (const scale of scales) {
        item.scores[scale.id] = snapToStep(scale.min + (scale.max - scale.min) * power, scale);
      }
      s.items.push(item);
    });
  });
  toast(`Добавлено демо-элементов: ${labels.length}`, 'good');
}

/* ============================== перемещение ============================== */

function handleDrop(itemId, zoneId, index, { quiet = false } = {}) {
  const state = store.state;
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;
  if (!state.autoAdjust) {
    store.placeItemManually(itemId, zoneId, index);
    const zone = state.zones.find((z) => z.id === zoneId);
    if (!quiet) toast(`Элемент закреплён в зоне «${zone?.name ?? ''}», баллы не изменены`, 'info');
    return { ok: true, adjusted: false, reason: 'manual-mode', zoneId };
  }
  const info = store.moveItem(itemId, zoneId, index);
  if (inspector?.itemId === itemId) focusItem(itemId);
  if (info?.message) toast(info.message, 'warn', 6000);
  else if (!quiet && info?.actual !== undefined && info?.actual !== null) {
    toast(`Баллы подстроены под позицию: итог ${fmt(info.actual, 2)}`, 'good', 2200);
  }
  return info;
}

/** Список элементов зоны в порядке отображения (без учёта баллов). */
function itemsOfZone(zoneIndex, state) {
  const row = layout(state)[zoneIndex];
  return row ? row.items.map((e) => e.item) : [];
}

/** Позиция элемента: { zoneIndex, index, list }. */
function positionOf(itemId, state) {
  const rows = layout(state);
  for (let zi = 0; zi < rows.length; zi += 1) {
    const ids = rows[zi].items.map((e) => e.item.id);
    const index = ids.indexOf(itemId);
    if (index >= 0) return { zoneIndex: zi, index, list: ids };
  }
  return null;
}

/**
 * Перемещение с клавиатуры (Alt + стрелки):
 * ←/→ — на позицию левее/правее внутри зоны, ↑/↓ — в зону выше/ниже.
 */
function moveByKeyboard(itemId, dir) {
  const state = store.state;
  const zones = state.zones;
  const pos = positionOf(itemId, state);
  if (!pos) return;
  if (dir === -1 || dir === 1) {
    const target = Math.max(0, Math.min(pos.list.length - 1, pos.index + dir));
    if (target === pos.index) return;
    handleDrop(itemId, zones[pos.zoneIndex].id, target);
    focusItem(itemId);
    return;
  }
  const nextZone = Math.max(0, Math.min(zones.length - 1, pos.zoneIndex + (dir === -2 ? -1 : 1)));
  if (nextZone === pos.zoneIndex) return;
  const targetList = itemsOfZone(nextZone, state).map((i) => i.id).filter((id) => id !== itemId);
  handleDrop(itemId, zones[nextZone].id, dir === -2 ? 0 : targetList.length);
  focusItem(itemId);
}

/** Прокрутить элемент в поле зрения (важно для перемещения с клавиатуры). */
function focusItem(itemId) {
  const tile = document.querySelector(`.tile[data-item-id="${itemId}"]`);
  if (tile) scrollIntoViewIfNeeded(tile, document.getElementById('board'));
}

/* ============================== инспектор элемента ============================== */

function openInspector(itemId, anchor) {
  if (inspector?.itemId === itemId) {
    inspector.handle.close();
    inspector = null;
    board.setSelected(null);
    return;
  }
  inspector?.handle.close();
  const handle = openItemInspector(anchor, itemId, store, {
    onMoveToZone: (id, zoneId) => {
      const zoneIndex = store.state.zones.findIndex((z) => z.id === zoneId);
      const list = itemsOfZone(zoneIndex, store.state).filter((i) => i.id !== id);
      handleDrop(id, zoneId, list.length);
    },
    zoneIdOf: (item) => zoneForItem(store.state, item)?.id,
  });
  inspector = { itemId, handle };
  board.setSelected(itemId);
  const originalClose = handle.close;
  handle.close = () => {
    originalClose();
    if (inspector?.itemId === itemId) inspector = null;
    board.setSelected(null);
  };
}

/* ============================== файлы ============================== */

function shortPath(path) {
  const parts = String(path).split(/[\\/]/);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
}

async function exportFile() {
  const json = exportJSON(store.state);
  const name = exportFileName(store.state.title);
  const res = await saveTextFile({
    suggestedName: name,
    content: json,
    filters: [{ name: 'JSON', extensions: ['json'] }],
    title: 'Экспорт тир-листа',
  });
  if (!res || res.canceled) return;
  if (res.ok) toast(`Тир-лист сохранён: ${res.path ? shortPath(res.path) : name}`, 'good', 5000);
  else toast(res.error || 'Не удалось сохранить файл', 'error');
}

async function importDialog() {
  const res = await openTextFile({
    filters: [{ name: 'JSON', extensions: ['json'] }],
    title: 'Импорт тир-листа',
  });
  if (!res || res.canceled) return;
  if (!res.ok) {
    toast(res.error || 'Не удалось прочитать файл', 'error');
    return;
  }
  applyImport(res.content, res.path);
}

function applyImport(text, path) {
  const parsed = parseImported(text);
  if (!parsed.ok) {
    toast(`Не удалось импортировать: ${parsed.errors[0]}`, 'error', 7000);
    return;
  }
  if (store.state.items.length && !confirm('Импорт заменит текущий тир-лист. Продолжить?')) return;
  inspector?.handle.close();
  store.replace(parsed.state, parsed.keepRanges);
  for (const warning of parsed.warnings) toast(warning, 'warn', 6000);
  toast(
    `Импортировано: зон ${parsed.meta.zones}, шкал ${parsed.meta.scales}, элементов ${parsed.meta.items}${path ? ` — ${shortPath(path)}` : ''}`,
    'good',
    5000
  );
}

function newList() {
  if (store.state.items.length && !confirm('Создать новый тир-лист? Текущий будет очищен.')) return;
  inspector?.handle.close();
  store.reset();
  toast('Создан новый тир-лист', 'good');
}

/* ============================== горячие клавиши и файлы извне ============================== */

function wireShortcuts() {
  const menuHandlesFiles = Boolean(window.tierlist?.isElectron); // в Electron за файлы отвечает меню
  document.addEventListener('keydown', (ev) => {
    const typing = isTypingTarget(ev.target);
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (!menuHandlesFiles && ctrl && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      exportFile();
    } else if (!menuHandlesFiles && ctrl && ev.key.toLowerCase() === 'o') {
      ev.preventDefault();
      importDialog();
    } else if (!menuHandlesFiles && ctrl && ev.key.toLowerCase() === 'n') {
      ev.preventDefault();
      newList();
    } else if (ev.key === 'Delete' && !typing && inspector?.itemId) {
      const item = store.state.items.find((i) => i.id === inspector.itemId);
      if (item && confirm(`Удалить элемент «${item.text || 'без названия'}»?`)) {
        store.removeItem(item.id);
        inspector.handle.close();
      }
    } else if (ev.key === 'F2' && !typing && inspector?.itemId) {
      ev.preventDefault();
      const input = document.querySelector('.popover-title input');
      input?.focus();
      input?.select();
    }
  });

  document.addEventListener('paste', async (ev) => {
    if (isTypingTarget(ev.target)) return;
    const dataUrl = await imageFromClipboard(ev.clipboardData);
    if (dataUrl) {
      ev.preventDefault();
      const { dataUrl: small } = await downscaleDataUrl(dataUrl, 512);
      store.addItem({ image: small });
      toast('Картинка из буфера добавлена как элемент', 'good');
      return;
    }
    const text = ev.clipboardData?.getData('text/plain');
    if (text && text.trim()) {
      ev.preventDefault();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 100);
      if (lines.length > 1) {
        for (const line of lines) store.addItem({ text: line });
        toast(`Добавлено элементов: ${lines.length}`, 'good');
      } else {
        store.addItem({ text: lines[0] });
      }
    }
  });
}

function wireFileDrop() {
  const stop = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  for (const type of ['dragenter', 'dragover', 'dragleave']) {
    document.addEventListener(type, (ev) => {
      if (ev.dataTransfer?.types?.includes('Files')) stop(ev);
    });
  }
  document.addEventListener('drop', async (ev) => {
    const files = [...(ev.dataTransfer?.files || [])];
    if (!files.length) return; // внутреннее перетаскивание элемента
    stop(ev);
    for (const file of files) {
      if (/\.json$/i.test(file.name)) {
        applyImport(await file.text(), file.name);
      } else if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataURL(file);
        const { dataUrl: small } = await downscaleDataUrl(dataUrl, 512);
        store.addItem({ image: small });
      } else {
        toast(`Файл «${file.name}» не поддержан: нужен JSON или картинка`, 'warn');
      }
    }
  });
}

/* ============================== утилиты (для отладки/тестов) ============================== */

window.__tierlist = {
  store,
  board,
  zonePanel,
  scalePanel,
  render,
  tooltipFor,
  dropItem: handleDrop,
  openInspector,
  itemsOfZone,
  itemTotals: (item) => itemTotal(item, store.state),
  exportJSON: () => exportJSON(store.state),
  seedDemo,
  importJSON: (text) => applyImport(text),
  newList,
  get inspector() {
    return inspector;
  },
};

init();
