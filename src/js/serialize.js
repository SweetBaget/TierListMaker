/**
 * Экспорт / импорт тир-листа в JSON.
 */

import { SCHEMA } from './constants.js';
import { activeScales, globalRange, itemBreakdown, itemTotal, layout } from './scoring.js';
import { Store } from './store.js';

/** Дата в формате ГГГГ-ММ-ДД. */
const today = () => new Date().toISOString().slice(0, 10);

/** Безопасное имя файла. */
export function safeFileName(name, ext) {
  const base = String(name || 'tier-list')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return `${base || 'tier-list'}.${ext}`;
}

/** Полный экспорт: состояние + удобное для чтения представление (без картинок-дублей). */
export function exportPayload(state) {
  const range = globalRange(state);
  const scales = activeScales(state);
  return {
    schema: SCHEMA,
    app: 'Tier List Maker',
    version: 1,
    exportedAt: new Date().toISOString(),
    title: state.title,
    mode: state.mode,
    autoAdjust: state.autoAdjust,
    scoreRange: range,
    zones: layout(state).map((row) => ({
      id: row.zone.id,
      name: row.zone.name,
      color: row.zone.color,
      min: row.zone.min,
      max: row.zone.max,
      items: row.items.map((e) => ({ id: e.item.id, text: e.item.text, total: e.total })),
    })),
    scales: state.scales.map((s) => ({ ...s })),
    items: state.items.map((it) => ({
      id: it.id,
      text: it.text,
      image: it.image,
      scores: { ...it.scores },
      frozen: { ...it.frozen },
      order: it.order,
      zoneId: it.zoneId ?? null,
      manual: it.manual === true,
      total: itemTotal(it, state),
      breakdown: itemBreakdown(it, state).map((b) => ({
        scale: b.scale.name,
        value: b.value,
        weight: b.weight,
        contribution: b.contribution,
        frozen: b.frozen,
      })),
    })),
    activeScales: scales.map((s) => s.id),
  };
}

export function exportJSON(state, { pretty = true } = {}) {
  return JSON.stringify(exportPayload(state), null, pretty ? 2 : 0);
}

/** Разбор JSON-файла импорта. Возвращает { ok, state|errors, warnings, meta }. */
export function parseImported(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (err) {
    return { ok: false, errors: [`Файл не является корректным JSON: ${err.message}`] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Ожидался объект с описанием тир-листа'] };
  }
  if (!Array.isArray(data.zones) && !Array.isArray(data.scales) && !Array.isArray(data.items)) {
    return { ok: false, errors: ['В файле нет ни зон, ни шкал, ни элементов — это не тир-лист'] };
  }

  const warnings = [];
  if (data.schema && data.schema !== SCHEMA) warnings.push(`Схема файла: ${data.schema}. Загружаем с приведением к текущему формату.`);
  if (data.version && Number(data.version) > 1) warnings.push(`Версия файла ${data.version} новее поддерживаемой.`);

  const store = new Store();
  const state = store.migrate(data);
  const hasRanges = Array.isArray(data.zones) && data.zones.every((z) => Number.isFinite(Number(z?.min)) && Number.isFinite(Number(z?.max)));
  return {
    ok: true,
    state,
    warnings,
    keepRanges: hasRanges,
    meta: { title: data.title, mode: data.mode, exportedAt: data.exportedAt, items: state.items.length, zones: state.zones.length, scales: state.scales.length },
  };
}

/** Текстовое описание итогового балла (для подсказок и заголовка панели). */
export function describeTotal(item, state) {
  const total = itemTotal(item, state);
  if (total === null) return 'нет включённых шкал';
  const parts = itemBreakdown(item, state).map((b) => `${b.scale.name}: ${b.value}×${b.weight}`);
  return `${parts.join(' + ')} = ${total}`;
}

export const exportFileName = (title) => safeFileName(`${title || 'tier-list'}_${today()}`, 'json');
