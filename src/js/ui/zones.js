/**
 * Панель зон (боковая) и всплывающая настройка зоны.
 */

import { ZONE_COLORS } from '../constants.js';
import { globalRange } from '../scoring.js';
import { el, fmt, inlineEdit, reconcile, toast } from './dom.js';

/** Список зон в боковой панели. */
export class ZonePanel {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.countPill = document.getElementById('zone-count');
  }

  render(state) {
    if (this.countPill) this.countPill.textContent = String(state.zones.length);
    reconcile(this.root, state.zones, {
      key: (z) => z.id,
      create: () => this.createRow(),
      update: (node, zone) => this.updateRow(node, zone, state),
    });
  }

  createRow() {
    const swatch = el('button', {
      class: 'swatch',
      type: 'button',
      title: 'Цвет зоны — клик переключает на следующий, Alt+клик — на предыдущий',
      onclick: (ev) => this.cycleColor(ev.currentTarget, ev.altKey ? -1 : 1),
    });
    const name = el('span', {
      class: 'zone-row-name',
      title: 'Клик — переименовать',
      onclick: (ev) => this.editName(ev.currentTarget),
    });
    const minInput = el('input', {
      type: 'text',
      inputMode: 'decimal',
      title: 'Минимальный балл зоны',
      onchange: (ev) => this.commitRange(ev.currentTarget, 'min'),
      onkeydown: (ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur();
      },
    });
    const maxInput = el('input', {
      type: 'text',
      inputMode: 'decimal',
      title: 'Максимальный балл зоны',
      onchange: (ev) => this.commitRange(ev.currentTarget, 'max'),
      onkeydown: (ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur();
      },
    });
    const range = el('div', { class: 'zone-row-range' }, [minInput, el('span', {}, ['…']), maxInput]);
    const main = el('div', { class: 'zone-row-main' }, [name, range]);
    const actions = el('div', { class: 'zone-row-actions' }, [
      el('button', {
        class: 'icon-btn',
        type: 'button',
        textContent: '▲',
        title: 'Переместить зону выше',
        onclick: (ev) => this.store.moveZone(this.rowZoneId(ev.currentTarget), -1),
      }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        textContent: '▼',
        title: 'Переместить зону ниже',
        onclick: (ev) => this.store.moveZone(this.rowZoneId(ev.currentTarget), 1),
      }),
      el('button', {
        class: 'icon-btn is-danger',
        type: 'button',
        textContent: '✕',
        title: 'Удалить зону',
        onclick: (ev) => this.store.removeZone(this.rowZoneId(ev.currentTarget)),
      }),
    ]);
    return el('div', { class: 'zone-row' }, [swatch, main, actions]);
  }

  rowZoneId(node) {
    return node.closest('.zone-row')?.dataset.key;
  }

  /** Цвет зоны меняется кликом по квадрату — без отдельных окон. */
  cycleColor(node, dir = 1) {
    const zoneId = this.rowZoneId(node);
    const zone = this.store.state.zones.find((z) => z.id === zoneId);
    if (!zone) return;
    const at = ZONE_COLORS.findIndex((color) => color.toLowerCase() === String(zone.color).toLowerCase());
    const next = ZONE_COLORS[(at + dir + ZONE_COLORS.length) % ZONE_COLORS.length];
    this.store.patchZone(zoneId, { color: next });
  }

  updateRow(node, zone, state) {
    const range = globalRange(state);
    const i = state.zones.indexOf(zone);
    node.querySelector('.swatch').style.background = zone.color;
    const nameEl = node.querySelector('.zone-row-name');
    if (node.dataset.editing !== 'name') nameEl.textContent = zone.name;
    const [minInput, maxInput] = node.querySelectorAll('.zone-row-range input');
    const active = document.activeElement;
    if (active !== minInput) minInput.value = fmt(zone.min, 2);
    if (active !== maxInput) maxInput.value = fmt(zone.max, 2);
    minInput.title = i === state.zones.length - 1 ? `Нижняя зона всегда начинается с минимума (${fmt(range.min, 2)})` : 'Минимальный балл зоны';
    maxInput.title = i === 0 ? `Верхняя зона всегда заканчивается максимумом (${fmt(range.max, 2)})` : 'Максимальный балл зоны';
    minInput.disabled = i === state.zones.length - 1;
    maxInput.disabled = i === 0;
    const [upBtn, downBtn, delBtn] = node.querySelectorAll('.zone-row-actions .icon-btn');
    upBtn.disabled = i === 0;
    downBtn.disabled = i === state.zones.length - 1;
    delBtn.disabled = state.zones.length <= 1;
    delBtn.title = state.zones.length <= 1 ? 'Нельзя удалить единственную зону' : 'Удалить зону';
  }

  editName(nameEl) {
    const row = nameEl.closest('.zone-row');
    const zoneId = row?.dataset.key;
    const zone = this.store.state.zones.find((z) => z.id === zoneId);
    if (!zone) return;
    row.dataset.editing = 'name';
    inlineEdit(nameEl, {
      value: zone.name,
      className: 'zone-row-name-input',
      onCommit: (value) => {
        row.dataset.editing = '';
        const next = String(value).trim().replace(/\s+/g, ' ');
        if (!next) {
          toast('Название зоны не может быть пустым', 'warn');
          return;
        }
        this.store.patchZone(zoneId, { name: next });
      },
      onCancel: () => {
        row.dataset.editing = '';
      },
    });
  }

  commitRange(input, field) {
    const zoneId = this.rowZoneId(input);
    const row = input.closest('.zone-row');
    const zone = this.store.state.zones.find((z) => z.id === zoneId);
    if (!zone) return;
    const raw = String(input.value).replace(',', '.');
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) {
      toast('Введите число', 'warn');
      this.render(this.store.state);
      return;
    }
    void row;
    this.store.patchZone(zoneId, { [field]: value });
    this.render(this.store.state);
  }

}
