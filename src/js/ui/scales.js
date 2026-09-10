/**
 * Панель шкал оценки: включение, «только я», название, точка отсчёта и окончания,
 * шаг, вес (множитель от 0), удаление.
 */

import { el, fmt, reconcile, toast } from './dom.js';
import { globalRange, normScale } from '../scoring.js';

export class ScalePanel {
  constructor(root, store) {
    this.root = root;
    this.store = store;
  }

  render(state) {
    reconcile(this.root, state.scales, {
      key: (s) => s.id,
      create: () => this.createRow(),
      update: (node, scale) => this.updateRow(node, scale, state),
    });
  }

  createRow() {
    const toggle = el('label', { class: 'switch', title: 'Учитывать шкалу в расчёте' }, [
      el('input', {
        type: 'checkbox',
        onchange: (ev) => this.store.toggleScale(this.scaleId(ev.currentTarget), ev.currentTarget.checked),
      }),
      el('span', { class: 'slider' }),
    ]);
    const name = el('input', {
      class: 'scale-name',
      type: 'text',
      spellcheck: false,
      title: 'Название шкалы',
      onchange: (ev) => this.commit(ev.currentTarget, 'name'),
      onkeydown: (ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur();
      },
    });
    const total = el('span', { class: 'scale-total' });
    const only = el('button', {
      class: 'icon-btn',
      type: 'button',
      textContent: '🎯',
      title: 'Только я — оставить включённой только эту шкалу',
      onclick: (ev) => {
        const id = this.scaleId(ev.currentTarget);
        this.store.onlyScale(id);
        toast('Включена только эта шкала — остальные исключены из расчёта', 'info');
      },
    });
    const del = el('button', {
      class: 'icon-btn is-danger',
      type: 'button',
      textContent: '✕',
      title: 'Удалить шкалу',
      onclick: (ev) => {
        const id = this.scaleId(ev.currentTarget);
        const scale = this.store.state.scales.find((s) => s.id === id);
        if (this.store.state.scales.length <= 1) {
          toast('Нельзя удалить единственную шкалу', 'warn');
          return;
        }
        if (confirm(`Удалить шкалу «${scale?.name}»? Баллы по ней будут потеряны.`)) this.store.removeScale(id);
      },
    });
    const head = el('div', { class: 'scale-row-head' }, [toggle, name, total, only, del]);

    const mk = (label, field, extra = {}) =>
      el('label', {}, [
        label,
        el('input', {
          type: 'text',
          inputMode: 'decimal',
          ...extra,
          onchange: (ev) => this.commit(ev.currentTarget, field),
          onkeydown: (ev) => {
            if (ev.key === 'Enter') ev.currentTarget.blur();
          },
        }),
      ]);
    const params = el('div', { class: 'scale-params' }, [
      mk('Старт', 'min', { title: 'Точка отсчёта шкалы' }),
      mk('Финиш', 'max', { title: 'Точка окончания шкалы' }),
      mk('Шаг', 'step', { title: 'Шаг изменения балла (0 — без шага)' }),
      el('label', { title: 'Вес шкалы — множитель от 0: во сколько раз балл по шкале входит в итог' }, [
        'Вес',
        el('span', { class: 'scale-weight-wrap' }, [
          el('input', {
            type: 'text',
            inputMode: 'decimal',
            onchange: (ev) => this.commit(ev.currentTarget, 'weight'),
            onkeydown: (ev) => {
              if (ev.key === 'Enter') ev.currentTarget.blur();
            },
          }),
        ]),
      ]),
    ]);

    return el('div', { class: 'scale-row' }, [head, params]);
  }

  scaleId(node) {
    return node.closest('.scale-row')?.dataset.key;
  }

  updateRow(node, scale, state) {
    const active = document.activeElement;
    const s = normScale(scale);
    const [checkbox] = node.querySelectorAll('.scale-row-head input[type=checkbox]');
    checkbox.checked = s.enabled;
    node.classList.toggle('is-off', !s.enabled);

    const nameInput = node.querySelector('.scale-name');
    if (active !== nameInput) nameInput.value = s.name;

    const range = globalRange(state);
    const enables = state.scales.filter((x) => x.enabled);
    const part = s.max * s.weight - s.min * s.weight;
    const share = range.max - range.min > 0 ? (part / (range.max - range.min)) * 100 : 0;
    node.querySelector('.scale-total').textContent = `${fmt(s.min, 2)}…${fmt(s.max, 2)} → ${fmt(part, 2)} б. (${Math.round(share)}%)`;
    node.querySelector('.scale-total').title = `Шкала даёт от ${fmt(s.min * s.weight, 2)} до ${fmt(s.max * s.weight, 2)} баллов в итоге`;

    const [minIn, maxIn, stepIn, weightIn] = node.querySelectorAll('.scale-params input');
    if (active !== minIn) minIn.value = fmt(s.min, 4);
    if (active !== maxIn) maxIn.value = fmt(s.max, 4);
    if (active !== stepIn) stepIn.value = fmt(s.step, 4);
    if (active !== weightIn) weightIn.value = fmt(s.weight, 4);
    minIn.disabled = false;
    void enables;

    const [onlyBtn, delBtn] = node.querySelectorAll('.scale-row-head .icon-btn');
    onlyBtn.classList.toggle('is-active', enables.length === 1 && s.enabled);
    onlyBtn.title = enables.length === 1 && s.enabled ? 'Эта шкала уже единственная включённая' : 'Только я — оставить включённой только эту шкалу';
    delBtn.disabled = state.scales.length <= 1;
    delBtn.title = state.scales.length <= 1 ? 'Нельзя удалить единственную шкалу' : 'Удалить шкалу';
  }

  commit(input, field) {
    const id = this.scaleId(input);
    const scale = this.store.state.scales.find((s) => s.id === id);
    if (!scale) return;
    if (field === 'name') {
      const value = input.value.trim();
      if (!value) {
        toast('Название шкалы не может быть пустым', 'warn');
        input.value = scale.name;
        return;
      }
      this.store.patchScale(id, { name: value });
      return;
    }
    const value = parseFloat(String(input.value).replace(',', '.'));
    if (!Number.isFinite(value)) {
      toast('Введите число', 'warn');
      this.render(this.store.state);
      return;
    }
    if (field === 'weight' && value < 0) {
      toast('Вес не может быть отрицательным', 'warn');
      this.store.patchScale(id, { weight: 0 });
      return;
    }
    if (field === 'step' && value < 0) {
      toast('Шаг не может быть отрицательным', 'warn');
      this.store.patchScale(id, { step: 0 });
      return;
    }
    this.store.patchScale(id, { [field]: value });
  }
}
