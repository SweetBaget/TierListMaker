/**
 * Всплывающая карточка настройки зоны (окно ⚙ у ярлыка зоны).
 */

import { ZONE_COLORS } from '../constants.js';
import { globalRange } from '../scoring.js';
import { el, fmt, openPopover } from './dom.js';

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

