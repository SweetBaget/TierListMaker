/**
 * Панель зон (боковая) и всплывающая настройка зоны.
 */

import { ZONE_COLORS } from '../constants.js';
import { globalRange } from '../scoring.js';
import { el, fmt, inlineEdit, openPopover, reconcile, toast } from './dom.js';

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
      title: 'Цвет зоны',
      onclick: (ev) => openZonePopover(ev.currentTarget, this.rowZoneId(ev.currentTarget), this.store),
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

/**
 * Всплывающая карточка настройки зоны: имя, цвет, диапазон, порядок, удаление.
 */
export function openZonePopover(anchor, zoneId, store) {
  const pop = { close: () => {} };
  const build = () => {
    const state = store.state;
    const zone = state.zones.find((z) => z.id === zoneId);
    if (!zone) {
      pop.close();
      return el('div');
    }
    const i = state.zones.indexOf(zone);
    const range = globalRange(state);
    const isTop = i === 0;
    const isBottom = i === state.zones.length - 1;

    const nameInput = el('input', {
      type: 'text',
      value: zone.name,
      onchange: (ev) => store.patchZone(zoneId, { name: ev.currentTarget.value.trim() || zone.name }),
      onkeydown: (ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur();
      },
    });
    const minInput = el('input', {
      type: 'number',
      step: 'any',
      value: zone.min,
      disabled: isBottom,
      onchange: (ev) => store.patchZone(zoneId, { min: parseFloat(ev.currentTarget.value) }),
    });
    const maxInput = el('input', {
      type: 'number',
      step: 'any',
      value: zone.max,
      disabled: isTop,
      onchange: (ev) => store.patchZone(zoneId, { max: parseFloat(ev.currentTarget.value) }),
    });
    const colors = el(
      'div',
      { class: 'color-grid' },
      ZONE_COLORS.map((color) =>
        el('button', {
          type: 'button',
          class: color.toLowerCase() === String(zone.color).toLowerCase() ? 'is-active' : '',
          style: { background: color },
          title: color,
          onclick: () => store.patchZone(zoneId, { color }),
        })
      )
    );

    return el('div', { class: 'zone-pop' }, [
      el('div', { class: 'popover-head' }, [
        el('div', { class: 'popover-title' }, [`Зона «${zone.name}»`]),
        el('div', { class: 'popover-total' }, [`${fmt(zone.min, 2)} … ${fmt(zone.max, 2)}`]),
      ]),
      el('label', { class: 'field' }, [el('span', {}, ['Название']), nameInput]),
      el('div', { class: 'scale-params', style: { gridTemplateColumns: '1fr 1fr' } }, [
        el('label', {}, ['Минимум', minInput]),
        el('label', {}, ['Максимум', maxInput]),
      ]),
      el('p', { class: 'card-note', style: { margin: '8px 0 4px' } }, [
        isTop
          ? 'Верхняя зона всегда заканчивается максимумом включённых шкал.'
          : isBottom
            ? 'Нижняя зона всегда начинается с минимума включённых шкал.'
            : 'Зоны стыкуются: изменение границы сдвигает соседнюю зону.',
      ]),
      el('label', { class: 'field' }, [el('span', {}, ['Цвет']), colors]),
      el('div', { class: 'popover-foot' }, [
        el('button', {
          class: 'btn',
          type: 'button',
          textContent: '▲ Выше',
          disabled: isTop,
          onclick: () => store.moveZone(zoneId, -1),
        }),
        el('button', {
          class: 'btn',
          type: 'button',
          textContent: '▼ Ниже',
          disabled: isBottom,
          onclick: () => store.moveZone(zoneId, 1),
        }),
        el('button', {
          class: 'btn',
          type: 'button',
          textContent: '⇕ Выровнять все зоны',
          title: `Поровну поделить диапазон ${fmt(range.min, 2)} … ${fmt(range.max, 2)}`,
          onclick: () => store.evenZones(),
        }),
        el('button', {
          class: 'btn is-danger',
          type: 'button',
          textContent: 'Удалить зону',
          disabled: state.zones.length <= 1,
          onclick: () => {
            store.removeZone(zoneId);
            pop.close();
          },
        }),
      ]),
    ]);
  };

  const content = build();
  const handle = openPopover({
    anchor,
    content,
    width: 360,
    onClose: () => {
      unsubscribe();
    },
  });
  pop.close = handle.close;
  const unsubscribe = store.subscribe(() => {
    const fresh = build();
    handle.el.replaceChildren(...fresh.childNodes);
    handle.reposition();
  });
  return handle;
}

