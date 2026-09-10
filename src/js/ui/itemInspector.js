/**
 * Всплывающая карточка элемента: название, картинка, баллы по шкалам,
 * заморозка отдельных шкал, перенос в зону, удаление.
 */

import { imageFromClipboard, downscaleDataUrl, pickImage } from '../files.js';
import { activeScales, itemBreakdown, itemTotal } from '../scoring.js';
import { el, fmt, openPopover, toast } from './dom.js';

export function openItemInspector(anchor, itemId, store, handlers = {}) {
  const pop = { close: () => {} };
  let unsubscribe = () => {};

  const build = () => {
    const state = store.state;
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return null;
    const scales = activeScales(state);
    const allScales = state.scales;
    const total = itemTotal(item, state);
    const breakdown = new Map(itemBreakdown(item, state).map((b) => [b.scale.id, b]));
    const zone = state.zones.find((z) => z.id === (handlers.zoneIdOf?.(item) ?? item.zoneId));
    const frozenCount = allScales.filter((s) => item.frozen?.[s.id]).length;

    /* --- заголовок --- */
    const title = el('input', {
      type: 'text',
      value: item.text,
      placeholder: 'Название элемента',
      spellcheck: false,
      title: 'Название элемента',
      oninput: (ev) => store.patchItem(itemId, { text: ev.currentTarget.value }),
    });
    const head = el('div', { class: 'popover-head' }, [
      el('div', { class: 'popover-title', style: { width: '100%' } }, [title]),
      el('div', { class: 'popover-total', title: 'Итоговый балл с учётом весов включённых шкал' }, [
        total === null ? '—' : fmt(total, 2),
      ]),
      el('button', {
        class: 'popover-close',
        type: 'button',
        textContent: '✕',
        title: 'Закрыть',
        onclick: () => pop.close(),
      }),
    ]);

    /* --- картинка --- */
    const preview = el('div', { class: 'item-preview' });
    if (item.image) preview.append(el('img', { src: item.image, alt: item.text || 'элемент' }));
    preview.append(
      el('div', { class: 'preview-actions' }, [
        el('button', {
          class: 'btn btn-small',
          type: 'button',
          textContent: item.image ? '🖼 Заменить картинку' : '🖼 Загрузить картинку',
          onclick: async () => {
            const res = await pickImage();
            if (!res || res.canceled) return;
            if (!res.ok) {
              toast(res.error || 'Не удалось открыть файл', 'error');
              return;
            }
            const { dataUrl } = await downscaleDataUrl(res.dataUrl, 512);
            store.patchItem(itemId, { image: dataUrl });
          },
        }),
        el('button', {
          class: 'btn btn-small',
          type: 'button',
          textContent: '📋 Из буфера',
          title: 'Вставить картинку из буфера обмена',
          onclick: async () => {
            try {
              const dataUrl = await imageFromClipboard(await navigator.clipboard.read());
              if (!dataUrl) {
                toast('В буфере обмена нет картинки', 'warn');
                return;
              }
              const shrunk = await downscaleDataUrl(dataUrl, 512);
              store.patchItem(itemId, { image: shrunk.dataUrl });
            } catch {
              toast('Браузер не дал доступ к буферу — нажмите Ctrl+V на странице', 'warn');
            }
          },
        }),
        item.image || item.text
          ? el('button', {
              class: 'btn btn-small is-danger',
              type: 'button',
              textContent: '🧹 Очистить',
              title: 'Убрать картинку и название',
              onclick: () => store.patchItem(itemId, { image: null, text: '' }),
            })
          : null,
      ])
    );

    /* --- перенос по зонам --- */
    const zoneButtons = el(
      'div',
      { class: 'color-grid', style: { gap: '4px' } },
      state.zones.map((z) =>
        el('button', {
          type: 'button',
          class: 'btn btn-small',
          style: { background: z.color, color: '#10141c', fontWeight: '600' },
          textContent: z.name.length > 8 ? `${z.name.slice(0, 8)}…` : z.name,
          title: `Перенести в зону «${z.name}» (${fmt(z.min, 2)} … ${fmt(z.max, 2)})`,
          onclick: () => handlers.onMoveToZone?.(itemId, z.id),
        })
      )
    );

    /* --- шкалы --- */
    const scaleRows = allScales.map((rawScale) => {
      const scale = activeScales(state).find((s) => s.id === rawScale.id) || rawScale;
      const info = breakdown.get(scale.id);
      const value = info ? info.value : Number(item.scores?.[scale.id] ?? scale.min);
      const frozen = Boolean(item.frozen?.[scale.id]);
      const row = el('div', {
        class: `scale-edit${frozen ? ' is-frozen' : ''}${scale.enabled ? '' : ' is-off'}`,
        dataset: { scaleId: scale.id },
      });
      const valueLabel = el('span', { class: 'scale-edit-value' }, [fmt(value, 4)]);

      const range = el('input', {
        type: 'range',
        min: scale.min,
        max: scale.max,
        step: scale.step > 0 ? scale.step : 'any',
        value,
        title: 'Потяните, чтобы задать балл по шкале',
        oninput: (ev) => store.setScore(itemId, scale.id, ev.currentTarget.value),
      });
      const number = el('input', {
        type: 'number',
        min: scale.min,
        max: scale.max,
        step: scale.step > 0 ? scale.step : 'any',
        value,
        title: 'Балл по шкале',
        oninput: (ev) => store.setScore(itemId, scale.id, ev.currentTarget.value),
      });
      const freezeBtn = el('button', {
        class: `freeze-btn${frozen ? ' is-on' : ''}`,
        type: 'button',
        textContent: frozen ? '❄ Заморожена' : '❄ Заморозить',
        title: frozen
          ? 'Шкала не меняется при автоматической подстройке. Нажмите, чтобы разморозить'
          : 'Заморозить: значение не будет меняться при ручном перемещении элемента',
        onclick: () => store.toggleFrozen(itemId, scale.id),
      });

      row.append(
        el('div', { class: 'scale-edit-head' }, [
          el('span', { class: 'scale-edit-name', title: scale.enabled ? 'Шкала включена в расчёт' : 'Шкала выключена из расчёта' }, [
            `${scale.enabled ? '' : '⏸ '}${scale.name}`,
          ]),
          el('span', { class: 'scale-edit-weight', title: 'Вес шкалы (множитель)' }, [`×${fmt(scale.weight, 4)}`]),
          frozen ? el('span', { class: 'scale-edit-weight', style: { color: 'var(--frozen)' }, title: 'Значение заморожено' }, ['❄']) : null,
          valueLabel,
        ]),
        el('div', { class: 'scale-edit-body' }, [range, number, freezeBtn])
      );

      if (!scale.enabled) {
        row.append(
          el('div', { class: 'hint', style: { marginTop: '4px' } }, [
            'Шкала выключена и не влияет на итог. ',
            el('button', {
              class: 'btn btn-small',
              type: 'button',
              textContent: 'Включить',
              onclick: () => store.toggleScale(scale.id, true),
            }),
          ])
        );
      } else if (info) {
        row.append(
          el('div', { class: 'hint', style: { marginTop: '4px' } }, [
            `Вклад в итог: ${fmt(info.value, 4)} × ${fmt(info.weight, 4)} = ${fmt(info.contribution, 4)}`,
          ])
        );
      }
      return row;
    });

    const hints = [];
    if (!scales.length) hints.push('Все шкалы выключены: положение элементов задаётся вручную.');
    if (zone) hints.push(`Сейчас в зоне «${zone.name}» (${fmt(zone.min, 2)} … ${fmt(zone.max, 2)}).`);
    if (item.manual && scales.length) hints.push('Элемент закреплён вручную — он останется в своей зоне, пока закрепление не снято.');
    if (frozenCount) hints.push(`Заморожено шкал: ${frozenCount} — при перемещении их баллы не изменятся.`);

    return el('div', {}, [
      head,
      preview,
      el('div', { class: 'field' }, [el('span', {}, ['Перенести в зону']), zoneButtons]),
      el('div', { class: 'field' }, [el('span', {}, ['Баллы по шкалам (вес учитывается в итоге)'])]),
      ...scaleRows,
      hints.length ? el('p', { class: 'card-note', style: { marginTop: '8px' } }, [hints.join(' ')]) : null,
      el('div', { class: 'popover-foot' }, [
        item.manual && scales.length
          ? el('button', {
              class: 'btn btn-small',
              type: 'button',
              textContent: '📍 Снять закрепление',
              title: 'Вернуть расчёт положения по баллам',
              onclick: () => store.unpinItem(itemId),
            })
          : null,
        el('button', {
          class: 'btn btn-small',
          type: 'button',
          textContent: '🔓 Снять все заморозки',
          disabled: !frozenCount,
          onclick: () => {
            store.update((s) => {
              const it = s.items.find((i) => i.id === itemId);
              if (it) it.frozen = {};
            });
          },
        }),
        el('button', {
          class: 'btn btn-small',
          type: 'button',
          textContent: '🧹 Обнулить баллы',
          title: 'Выставить минимум по всем свободным шкалам',
          onclick: () => {
            store.update((s) => {
              const it = s.items.find((i) => i.id === itemId);
              if (!it) return;
              activeScales(s).forEach((sc) => {
                if (!it.frozen?.[sc.id]) it.scores[sc.id] = sc.min;
              });
            });
          },
        }),
        el('button', {
          class: 'btn btn-small is-danger',
          type: 'button',
          textContent: '🗑 Удалить элемент',
          onclick: () => {
            store.removeItem(itemId);
            pop.close();
          },
        }),
      ]),
    ]);
  };

  const content = build();
  if (!content) return { close: () => {} };

  const handle = openPopover({
    anchor,
    content,
    width: 400,
    onClose: () => unsubscribe(),
  });
  pop.close = handle.close;

  unsubscribe = store.subscribe(() => {
    const state = store.state;
    const item = state.items.find((i) => i.id === itemId);
    if (!item) {
      handle.close();
      return;
    }
    const scaleIds = content.querySelectorAll('.scale-edit');
    const currentIds = [...scaleIds].map((n) => n.dataset.scaleId).join(',');
    const wantedIds = state.scales.map((s) => s.id).join(',');
    // Обновляем значения «на месте», не теряя фокус и не мешая перетаскиванию ползунков
    if (currentIds === wantedIds) {
      const total = itemTotal(item, state);
      const badge = content.querySelector('.popover-total');
      if (badge) badge.textContent = total === null ? '—' : fmt(total, 2);
      const titleInput = content.querySelector('.popover-title input');
      if (titleInput && document.activeElement !== titleInput) titleInput.value = item.text;

      for (const row of content.querySelectorAll('.scale-edit')) {
        const id = row.dataset.scaleId;
        const scale = state.scales.find((s) => s.id === id);
        if (!scale) continue;
        const frozen = Boolean(item.frozen?.[id]);
        row.classList.toggle('is-frozen', frozen);
        const value = Number(item.scores?.[id] ?? scale.min);
        const [range, number] = row.querySelectorAll('.scale-edit-body input');
        const label = row.querySelector('.scale-edit-value');
        if (label) label.textContent = fmt(value, 4);
        if (document.activeElement !== range) range.value = value;
        if (document.activeElement !== number) number.value = value;
        const btn = row.querySelector('.freeze-btn');
        if (btn) {
          btn.classList.toggle('is-on', frozen);
          btn.textContent = frozen ? '❄ Заморожена' : '❄ Заморозить';
        }
      }
      handle.reposition();
      return;
    }
    const fresh = build();
    if (fresh) handle.el.replaceChildren(...fresh.childNodes);
    handle.reposition();
  });

  return handle;
}

