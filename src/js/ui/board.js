/**
 * Область тир-листа: зоны, элементы, перетаскивание, правка «на месте».
 */

import { el, fmt, inlineEdit, reconcile, toast } from './dom.js';
import { itemBreakdown, itemTotal, zoneForItem } from '../scoring.js';

/** Подсказка по элементу: текстом и по шкалам. */
function tooltipFor(item, state) {
  const total = itemTotal(item, state);
  const lines = [item.text ? item.text : 'Элемент с картинкой'];
  if (total === null) lines.push('Нет включённых шкал — положение задано вручную');
  else {
    lines.push(`Итог: ${fmt(total)}`);
    for (const b of itemBreakdown(item, state)) {
      lines.push(
        `${b.frozen ? '❄ ' : ''}${b.scale.name}: ${fmt(b.value)} ×${fmt(b.scale.weight, 2)} = ${fmt(b.contribution)}`
      );
    }
  }
  lines.push('Клик — редактировать · перетащите для смены зоны');
  return lines.join('\n');
}

export class Board {
  /**
   * @param {HTMLElement} root контейнер .board
   * @param {object} handlers { onDropItem, onOpenItem, onPatchZone, onMoveZone, onRemoveZone, onAddZone }
   */
  constructor(root, handlers = {}) {
    this.root = root;
    this.h = handlers;
    this.state = null;
    this.drag = null;
    this.marker = null;
    this.root.classList.add('board');
  }

  render(state) {
    this.state = state;
    if (this.drag) {
      // во время перетаскивания не перерисовываем, но запоминаем необходимость
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    const zones = state.zones || [];
    const byZone = new Map(zones.map((z) => [z.id, []]));
    const totals = new Map();
    for (const item of state.items || []) {
      const total = itemTotal(item, state);
      totals.set(item.id, total);
      const zone = this.zoneForItem(item, total, state);
      if (zone) (byZone.get(zone.id) || []).push({ item, total });
    }
    for (const list of byZone.values()) {
      list.sort((a, b) => {
        const at = a.total ?? Number.NEGATIVE_INFINITY;
        const bt = b.total ?? Number.NEGATIVE_INFINITY;
        if (Math.abs(bt - at) > 1e-9) return bt - at;
        return (a.item.order ?? 0) - (b.item.order ?? 0);
      });
    }

    reconcile(this.root, zones, {
      key: (z) => z.id,
      create: (z) => this.createZoneRow(z),
      update: (node, z) => this.updateZoneRow(node, z, byZone.get(z.id) || [], totals),
    });
  }

  zoneForItem(item, total, state) {
    return zoneForItem(state, item, total);
  }

  /* ------------------------------ зоны ------------------------------ */

  createZoneRow(zone) {
    const name = el('div', {
      class: 'zone-name',
      tabIndex: 0,
      role: 'button',
      title: 'Клик — изменить название зоны (Enter — редактировать)',
      onclick: (ev) => this.editZoneName(ev.currentTarget, zone.id),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          this.editZoneName(ev.currentTarget, zone.id);
        }
      },
    });
    const range = el('div', {
      class: 'zone-range',
      tabIndex: 0,
      role: 'button',
      title: 'Клик — изменить диапазон зоны (Enter — редактировать)',
      onclick: (ev) => this.editZoneRange(ev.currentTarget, zone.id),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          this.editZoneRange(ev.currentTarget, zone.id);
        }
      },
    });
    const actions = el('div', { class: 'zone-label-actions' }, [
      el('button', {
        class: 'mini-btn',
        type: 'button',
        title: 'Переместить зону выше',
        textContent: '▲',
        onclick: (ev) => {
          ev.stopPropagation();
          this.h.onMoveZone?.(zone.id, -1);
        },
      }),
      el('button', {
        class: 'mini-btn',
        type: 'button',
        title: 'Переместить зону ниже',
        textContent: '▼',
        onclick: (ev) => {
          ev.stopPropagation();
          this.h.onMoveZone?.(zone.id, 1);
        },
      }),
      el('button', {
        class: 'mini-btn',
        type: 'button',
        title: 'Настроить зону (цвет, диапазон, удаление)',
        textContent: '⚙',
        onclick: (ev) => {
          ev.stopPropagation();
          this.h.onOpenZone?.(zone.id, ev.currentTarget);
        },
      }),
    ]);
    const label = el('div', { class: 'zone-label' }, [name, range, actions]);
    const items = el('div', { class: 'zone-items', dataset: { zoneId: zone.id } });
    const row = el('div', { class: 'zone', dataset: { zoneId: zone.id } }, [label, items]);

    items.addEventListener('dragover', (ev) => this.onDragOver(ev, items, zone.id));
    items.addEventListener('dragleave', (ev) => {
      if (ev.currentTarget === ev.target) this.clearMarker();
    });
    items.addEventListener('drop', (ev) => this.onDrop(ev, items, zone.id));
    return row;
  }

  updateZoneRow(node, zone, entries) {
    node.style.setProperty('--zone-color', zone.color);
    const label = node.querySelector('.zone-label');
    const nameEl = label.querySelector('.zone-name');
    const rangeEl = label.querySelector('.zone-range');
    if (label.dataset.editing !== 'name') nameEl.textContent = zone.name;
    if (label.dataset.editing !== 'range') rangeEl.textContent = `${fmt(zone.min, 2)} … ${fmt(zone.max, 2)}`;
    const items = node.querySelector('.zone-items');
    items.dataset.emptyHint = entries.length ? '' : 'Пусто — перетащите элемент сюда';
    items.classList.toggle('is-empty', entries.length === 0);

    reconcile(items, entries, {
      key: (e) => e.item.id,
      create: (e) => this.createTile(e),
      update: (tile, e) => this.updateTile(tile, e, node),
    });
  }

  /* --------------------------- правка «на месте» --------------------------- */

  editZoneName(nameEl, zoneId) {
    const zone = this.state.zones.find((z) => z.id === zoneId);
    if (!zone) return;
    const label = nameEl.closest('.zone-label');
    label.dataset.editing = 'name';
    nameEl.dataset.raw = zone.name;
    inlineEdit(nameEl, {
      value: zone.name,
      onCommit: (value) => {
        const next = value.trim().replace(/\s+/g, ' ');
        label.dataset.editing = '';
        if (!next) {
          toast('Название зоны не может быть пустым', 'warn');
          return;
        }
        this.h.onPatchZone?.(zoneId, { name: next });
      },
      onCancel: () => {
        label.dataset.editing = '';
      },
    });
  }

  editZoneRange(rangeEl, zoneId) {
    const zone = this.state.zones.find((z) => z.id === zoneId);
    if (!zone) return;
    const label = rangeEl.closest('.zone-label');
    label.dataset.editing = 'range';
    const host = rangeEl;
    inlineEdit(host, {
      value: `${fmt(zone.min, 2)} … ${fmt(zone.max, 2)}`,
      isRange: true,
      onCommit: (value) => {
        label.dataset.editing = '';
        const nums = (String(value).match(/-?\d+(?:[.,]\d+)?/g) || []).map((s) => parseFloat(s.replace(',', '.')));
        if (nums.length < 2) {
          toast('Укажите два числа через пробел: «минимум … максимум»', 'warn');
          return;
        }
        const min = Math.min(nums[0], nums[1]);
        const max = Math.max(nums[0], nums[1]);
        this.h.onPatchZone?.(zoneId, { min, max });
      },
      onCancel: () => {
        label.dataset.editing = '';
      },
    });
  }

  /* ------------------------------ элементы ------------------------------ */

  createTile(entry) {
    const item = entry.item;
    const tile = el('div', {
      class: 'tile',
      draggable: 'true',
      tabIndex: 0,
      role: 'button',
      dataset: { itemId: item.id },
      onclick: (ev) => this.h.onOpenItem?.(item.id, ev.currentTarget),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          this.h.onOpenItem?.(item.id, ev.currentTarget);
          return;
        }
        if (!ev.altKey) return;
        const dir = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[ev.key];
        if (!dir) return;
        ev.preventDefault();
        this.h.onKeyMove?.(item.id, dir);
      },
      ondragstart: (ev) => this.onDragStart(ev, item.id, tile),
      ondragend: () => this.onDragEnd(),
    });
    return tile;
  }

  updateTile(tile, entry, zoneRow) {
    const { item, total } = entry;
    const state = this.state;
    tile.title = tooltipFor(item, state);
    tile.classList.toggle('is-selected', this.h.isSelected?.(item.id) === true);
    const anyFrozen = Object.values(item.frozen || {}).some(Boolean);
    tile.classList.toggle('is-frozen', anyFrozen);
    const wanted = [];
    if (item.image) wanted.push(el('img', { src: item.image, alt: item.text || 'элемент' }));
    if (item.text) wanted.push(el('span', { class: 'tile-text' }, [item.text]));
    if (!item.image && !item.text) wanted.push(el('span', { class: 'tile-text' }, ['(без названия)']));
    if (total !== null && total !== undefined) wanted.push(el('span', { class: 'tile-score' }, [fmt(total, 2)]));
    if (anyFrozen) wanted.push(el('span', { class: 'tile-freeze', title: 'Есть замороженные шкалы' }, ['❄']));
    const signature = wanted.map((n) => `${n.tagName}:${n.className}:${n.src || n.textContent}`).join('|');
    if (tile.dataset.signature !== signature) {
      tile.dataset.signature = signature;
      tile.replaceChildren(...wanted);
    }
    void zoneRow;
  }

  /* --------------------------- перетаскивание --------------------------- */

  onDragStart(ev, itemId, tile) {
    this.drag = { itemId };
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', itemId);
    // собственный «слепок» перетаскивания
    try {
      ev.dataTransfer.setDragImage(tile, tile.offsetWidth / 2, tile.offsetHeight / 2);
    } catch {
      /* ignore */
    }
    tile.classList.add('is-dragging');
    this.root.classList.add('is-dragging');
    document.body.classList.add('dragging-cursor');
  }

  onDragOver(ev, container, zoneId) {
    if (!this.drag) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const index = this.indexFromPoint(container, ev.clientX, ev.clientY);
    this.showMarker(container, index);
    this.root.querySelectorAll('.zone.is-drop-target').forEach((z) => z.classList.remove('is-drop-target'));
    container.closest('.zone')?.classList.add('is-drop-target');
    void zoneId;
  }

  onDrop(ev, container, zoneId) {
    if (!this.drag) return; // это не перетаскивание элемента (например, файл из проводника)
    ev.preventDefault();
    const itemId = this.drag?.itemId || ev.dataTransfer.getData('text/plain');
    const index = this.indexFromPoint(container, ev.clientX, ev.clientY);
    this.clearMarker();
    this.drag = null;
    this.root.classList.remove('is-dragging');
    document.body.classList.remove('dragging-cursor');
    this.root.querySelectorAll('.tile.is-dragging').forEach((t) => t.classList.remove('is-dragging'));
    this.root.querySelectorAll('.zone.is-drop-target').forEach((z) => z.classList.remove('is-drop-target'));
    if (itemId) this.h.onDropItem?.(itemId, zoneId, index);
    if (this.pendingRender && this.state) this.render(this.state);
  }

  onDragEnd() {
    this.drag = null;
    this.clearMarker();
    this.root.classList.remove('is-dragging');
    document.body.classList.remove('dragging-cursor');
    this.root.querySelectorAll('.tile.is-dragging').forEach((t) => t.classList.remove('is-dragging'));
    this.root.querySelectorAll('.zone.is-drop-target').forEach((z) => z.classList.remove('is-drop-target'));
    if (this.pendingRender && this.state) this.render(this.state);
  }

  /** Индекс вставки по позиции курсора. */
  indexFromPoint(container, x, y) {
    const tiles = [...container.querySelectorAll('.tile:not(.is-dragging)')];
    for (let i = 0; i < tiles.length; i += 1) {
      const r = tiles[i].getBoundingClientRect();
      const sameRow = y >= r.top - 8 && y <= r.bottom + 8;
      if (sameRow && x < r.left + r.width / 2) return i;
      if (!sameRow && y < r.top) return i;
    }
    return tiles.length;
  }

  showMarker(container, index) {
    if (!this.marker) this.marker = el('div', { class: 'drop-marker' });
    const tiles = [...container.querySelectorAll('.tile:not(.is-dragging)')];
    const ref = tiles[index] || null;
    if (this.marker.parentElement !== container || this.marker.nextSibling !== ref) {
      container.insertBefore(this.marker, ref);
    }
  }

  clearMarker() {
    this.marker?.remove();
    this.marker = null;
    this.root.querySelectorAll('.zone.is-drop-target').forEach((z) => z.classList.remove('is-drop-target'));
  }

  /** Выделить элемент (подсветка выбранного). */
  setSelected(itemId) {
    this.selected = itemId;
    this.root.querySelectorAll('.tile').forEach((t) => t.classList.toggle('is-selected', t.dataset.itemId === itemId));
  }

}

export { tooltipFor };
