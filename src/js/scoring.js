/**
 * Чистая логика тир-листа: баллы, диапазоны зон, авто-подстройка шкал.
 * Модуль не зависит от DOM и тестируется в Node.
 */

import { MODE_AVG, MODE_SUM } from './constants.js';

export const EPS = 1e-9;

export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const round6 = (v) => Math.round(v * 1e6) / 1e6;
export const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** Мягкий парсинг числа (понимает запятую как десятичный разделитель). */
export function toNum(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseFloat(String(value).replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

/** Приведение шкалы к корректному виду (max >= min, weight >= 0, step >= 0). */
export function normScale(raw) {
  let min = toNum(raw.min, 0);
  let max = toNum(raw.max, 10);
  if (max < min) [min, max] = [max, min];
  return {
    ...raw,
    id: String(raw.id),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Шкала',
    min,
    max,
    step: Math.max(0, toNum(raw.step, 0)),
    weight: Math.max(0, toNum(raw.weight, 1)),
    enabled: raw.enabled !== false,
  };
}

export const activeScales = (state) => (state.scales || []).map(normScale).filter((s) => s.enabled);

/**
 * Значение, приведённое к сетке шкалы (шаг) и к её границам.
 */
export function snapToStep(value, scale) {
  const s = normScale(scale);
  let v = clamp(toNum(value, s.min), s.min, s.max);
  if (s.step > EPS) v = clamp(s.min + Math.round((v - s.min) / s.step) * s.step, s.min, s.max);
  return round6(v);
}

/**
 * Веса шкал для расчёта.
 * MODE_SUM: вес 0 означает, что шкала не влияет на сумму (множитель от 0).
 * MODE_AVG: если сумма весов равна 0 — считаем веса единичными (иначе деление на 0).
 */
export function weightMap(scales, mode) {
  const weights = new Map();
  let sum = 0;
  for (const s of scales) {
    weights.set(s.id, s.weight);
    sum += s.weight;
  }
  if (mode === MODE_AVG && sum <= EPS) {
    for (const s of scales) weights.set(s.id, 1);
    sum = scales.length;
  }
  return { weights, sum };
}

/** Значение элемента по шкале (по умолчанию — минимум шкалы). */
export function scoreOf(item, scale) {
  const raw = item?.scores?.[scale.id];
  return snapToStep(raw === undefined || raw === null ? scale.min : raw, scale);
}

/** Итоговый балл элемента (null, если нет ни одной включённой шкалы). */
export function itemTotal(item, state) {
  const scales = activeScales(state);
  if (!scales.length) return null;
  const { weights, sum } = weightMap(scales, state.mode);
  let acc = 0;
  for (const s of scales) acc += scoreOf(item, s) * weights.get(s.id);
  if (state.mode === MODE_AVG) return sum > EPS ? round6(acc / sum) : 0;
  return round6(acc);
}

/** Разбор итогового балла по шкалам — для подсказок и панели элемента. */
export function itemBreakdown(item, state) {
  const scales = activeScales(state);
  const { weights } = weightMap(scales, state.mode);
  return scales.map((s) => {
    const value = scoreOf(item, s);
    const weight = weights.get(s.id);
    return {
      scale: s,
      value,
      weight,
      contribution: round6(value * weight),
      frozen: Boolean(item?.frozen?.[s.id]),
    };
  });
}

/** Возможный диапазон баллов по текущему набору включённых шкал. */
export function globalRange(state) {
  const scales = activeScales(state);
  if (!scales.length) return { min: 0, max: 0, hasScales: false };
  const { weights, sum } = weightMap(scales, state.mode);
  let min = 0;
  let max = 0;
  for (const s of scales) {
    const w = weights.get(s.id);
    min += s.min * w;
    max += s.max * w;
  }
  if (state.mode === MODE_AVG && sum > EPS) {
    min /= sum;
    max /= sum;
  }
  return { min: round6(Math.min(min, max)), max: round6(Math.max(min, max)), hasScales: true };
}

/** Равномерная раскладка диапазонов зон внутри общего диапазона. */
export function evenZoneRanges(zones, range) {
  const n = zones.length || 1;
  const span = range.max - range.min;
  return zones.map((z, i) => ({
    ...z,
    min: round4(range.max - (span * (i + 1)) / n),
    max: round4(range.max - (span * i) / n),
  }));
}

/**
 * Пересчёт границ зон под новый общий диапазон.
 * Верхняя зона получает max = общий максимум, нижняя — min = общий минимум.
 * Внутренние границы масштабируются пропорционально (сохраняя настройку пользователя).
 */
export function normalizeZoneRanges(zones, range, prevRange) {
  const list = zones.length ? zones.map((z) => ({ ...z })) : [];
  if (!list.length) return list;
  if (!prevRange || Math.abs(prevRange.max - prevRange.min) < EPS) {
    return evenZoneRanges(list, range);
  }
  const prevSpan = prevRange.max - prevRange.min;
  const span = range.max - range.min;
  const map = (v) => round4(clamp(range.min + ((toNum(v) - prevRange.min) / prevSpan) * span, range.min, range.max));

  // Границы снизу вверх: b0 = минимум диапазона, далее максимумы зон от нижней к верхней, bn = максимум диапазона.
  const bounds = [range.min];
  for (let i = list.length - 1; i >= 1; i -= 1) bounds.push(map(list[i].max));
  bounds.push(range.max);
  for (let i = 1; i < bounds.length; i += 1) if (bounds[i] < bounds[i - 1]) bounds[i] = bounds[i - 1];
  // верхняя зона всегда заканчивается общим максимумом, нижняя начинается с общего минимума
  bounds[0] = range.min;
  bounds[bounds.length - 1] = range.max;
  for (let i = 1; i < bounds.length; i += 1) if (bounds[i] > range.max) bounds[i] = range.max;

  // bounds идут снизу вверх, зоны — сверху вниз
  return list.map((z, i) => ({ ...z, min: bounds[list.length - 1 - i], max: bounds[list.length - i] }));
}

/** Индекс зоны, в диапазон которой попадает балл (зоны идут сверху вниз). */
export function zoneIndexForTotal(total, zones) {
  if (!zones || !zones.length) return -1;
  if (total === null || total === undefined || !Number.isFinite(total)) return 0;
  for (let i = 0; i < zones.length; i += 1) {
    if (total >= toNum(zones[i].min) - EPS) return i;
  }
  return zones.length - 1;
}

/**
 * Зона элемента: по баллу, либо закреплённая вручную (item.manual) / при отсутствии шкал.
 */
export function zoneForItem(state, item, total) {
  const zones = state.zones || [];
  if (!zones.length) return null;
  const total2 = total === undefined ? itemTotal(item, state) : total;
  if (item.manual || total2 === null || total2 === undefined) {
    const found = zones.find((z) => z.id === item.zoneId);
    return found || zones[zones.length - 1];
  }
  return zones[zoneIndexForTotal(total2, zones)];
}

/** Раскладка: элементы, сгруппированные по зонам, внутри зоны — по убыванию баллов. */
export function layout(state) {
  const zones = state.zones || [];
  const rows = zones.map((zone) => ({ zone, items: [] }));
  if (!rows.length) return rows;
  const hasScales = activeScales(state).length > 0;
  const entries = (state.items || []).map((item) => {
    const total = hasScales ? itemTotal(item, state) : null;
    const zone = zoneForItem(state, item, total);
    const idx = zone ? zones.indexOf(zone) : zones.length - 1;
    return { item, total, idx, zone };
  });
  entries.sort((a, b) => {
    const at = a.total === null || a.total === undefined ? Number.NEGATIVE_INFINITY : a.total;
    const bt = b.total === null || b.total === undefined ? Number.NEGATIVE_INFINITY : b.total;
    if (Math.abs(bt - at) > EPS) return bt - at;
    const ao = Number.isFinite(a.item.order) ? a.item.order : 0;
    const bo = Number.isFinite(b.item.order) ? b.item.order : 0;
    if (ao !== bo) return ao - bo;
    return String(a.item.id).localeCompare(String(b.item.id));
  });
  for (const entry of entries) rows[entry.idx].items.push(entry);
  return rows;
}

/** Плоский отсортированный список элементов (для экспорта/отладки). */
export function sortedItems(state) {
  return layout(state).flatMap((row) => row.items.map((e) => e.item.id));
}

/**
 * Подбор баллов по свободным (не замороженным) шкалам так, чтобы итог был максимально
 * близок к target. Замороженные шкалы сохраняют свои значения.
 *
 * @returns {{values: Object<string, number>, total: number|null}}
 */
export function planScores({ target, mode, scales, freeIds, fixedValues = {} }) {
  const list = scales.map(normScale);
  const free = list.filter((s) => freeIds.has(s.id));
  if (!free.length) return { values: {}, total: null };

  const { weights, sum } = weightMap(list, mode);
  let fixedSum = 0;
  for (const s of list) {
    if (freeIds.has(s.id)) continue;
    fixedSum += toNum(fixedValues[s.id], s.min) * weights.get(s.id);
  }

  // требуемая сумма «взвешенных» баллов свободных шкал
  let need = mode === MODE_AVG ? toNum(target) * sum - fixedSum : toNum(target) - fixedSum;

  let cMin = 0;
  let cMax = 0;
  for (const s of free) {
    const w = weights.get(s.id);
    cMin += s.min * w;
    cMax += s.max * w;
  }
  need = clamp(need, cMin, cMax);

  const span = cMax - cMin;
  const ratio = span > EPS ? (need - cMin) / span : 0;
  const values = {};
  for (const s of free) values[s.id] = snapToStep(s.min + (s.max - s.min) * ratio, s);

  const sumOf = () => {
    let acc = 0;
    for (const s of free) acc += values[s.id] * weights.get(s.id);
    return acc;
  };
  const totalOf = () => (mode === MODE_AVG ? (sum > EPS ? (fixedSum + sumOf()) / sum : 0) : fixedSum + sumOf());

  // Коррекция остатка пошаговыми сдвигами (шаги шкал, веса учитываются)
  let residual = need - sumOf();
  let guard = 0;
  while (Math.abs(residual) > 1e-7 && guard < 800) {
    guard += 1;
    let best = null;
    for (const s of free) {
      if (s.step <= EPS) continue;
      const w = weights.get(s.id);
      for (const dir of [1, -1]) {
        const nv = round6(clamp(values[s.id] + dir * s.step, s.min, s.max));
        if (Math.abs(nv - values[s.id]) < 1e-12) continue;
        const delta = (nv - values[s.id]) * w;
        const score = Math.abs(residual - delta);
        if (score < Math.abs(residual) - 1e-12 && (!best || score < best.score)) {
          best = { id: s.id, nv, delta, score };
        }
      }
    }
    if (!best) break;
    values[best.id] = best.nv;
    residual = round6(residual - best.delta);
  }

  return { values, total: round6(totalOf()) };
}

/**
 * Минимальный (по влиянию на итог) шаг свободных шкал в заданную сторону.
 * Возвращает кандидата, не меняя values.
 */
function pickStep(values, freeScales, weights, dir) {
  let best = null;
  for (const s of freeScales) {
    if (s.step <= EPS) continue;
    const nv = round6(clamp(values[s.id] + dir * s.step, s.min, s.max));
    if (Math.abs(nv - values[s.id]) < 1e-12) continue;
    const delta = (nv - values[s.id]) * weights.get(s.id);
    if (Math.abs(delta) < 1e-12) continue;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { id: s.id, nv, delta };
  }
  return best;
}

/**
 * Перенос элемента в зону на позицию index с авто-подстройкой свободных шкал.
 *
 * Правила обоснования положения:
 *  - если справа есть элемент — целевой балл равен баллу правого соседа
 *    (равенство даёт место слева от него);
 *  - иначе — минимальный балл зоны.
 * Итог — минимально возможное значение, обосновывающее позицию: после планирования
 * он втягивается в интервал [балл правого соседа .. балл левого соседа]
 * (граница зоны, если соседа с этой стороны нет), не перепрыгивая через него.
 *
 * @returns {{state: object, info: object}} новое состояние и описание операции
 */
export function applyMove(state, itemId, zoneId, index) {
  const next = structuredClone(state);
  const item = (next.items || []).find((i) => i.id === itemId);
  const zoneIdx = (next.zones || []).findIndex((z) => z.id === zoneId);
  if (!item || zoneIdx < 0) return { state, info: { ok: false, reason: 'not-found' } };

  const rows = layout(next);
  const currentZoneIdx = rows.findIndex((r) => r.items.some((e) => e.item.id === itemId));
  const currentIndex = currentZoneIdx >= 0 ? rows[currentZoneIdx].items.findIndex((e) => e.item.id === itemId) : -1;
  const zoneLists = rows.map((r) => r.items.map((e) => e.item.id).filter((id) => id !== itemId));
  if (!zoneLists[zoneIdx]) return { state, info: { ok: false, reason: 'not-found' } };
  const targetList = zoneLists[zoneIdx];
  const idx = clamp(Math.round(toNum(index, 0)), 0, targetList.length);

  // отпустили на том же месте — ничего не меняем, чтобы баллы не «плыли»
  if (currentZoneIdx === zoneIdx && currentIndex === idx) {
    return { state, info: { ok: true, unchanged: true, adjusted: false } };
  }
  targetList.splice(idx, 0, itemId);

  const totalById = (id) => itemTotal((next.items || []).find((i) => i.id === id), next);
  const rightId = targetList[idx + 1];
  const leftId = targetList[idx - 1];
  const rightTotal = rightId ? totalById(rightId) : null;
  const leftTotal = leftId ? totalById(leftId) : null;
  const zone = next.zones[zoneIdx];

  // цель по спецификации: минимум интервала, обосновывающего позицию
  const lower = rightId && rightTotal !== null ? clamp(rightTotal, zone.min, zone.max) : zone.min;
  const upper = leftId && leftTotal !== null ? clamp(leftTotal, zone.min, zone.max) : zone.max;
  const target = lower;

  const applyOrder = () => {
    let order = 0;
    for (const list of zoneLists) {
      for (const id of list) {
        const it = next.items.find((i) => i.id === id);
        if (it) it.order = order;
        order += 1;
      }
    }
  };

  const scales = activeScales(next);
  const freeScales = scales.filter((s) => !item.frozen?.[s.id]);

  if (!scales.length || !freeScales.length) {
    applyOrder();
    item.zoneId = zoneId;
    if (!scales.length) item.manual = true; // баллов нет — положение задаётся вручную
    return {
      state: next,
      info: {
        ok: false,
        adjusted: false,
        reason: scales.length ? 'frozen' : 'no-scales',
        message: scales.length
          ? 'Все включённые шкалы заморожены для этого элемента — баллы не изменены'
          : 'Нет включённых шкал — положение задано вручную',
        target,
      },
    };
  }

  const fixedValues = {};
  for (const s of scales) if (item.frozen?.[s.id]) fixedValues[s.id] = scoreOf(item, s);

  const plan = planScores({
    target,
    mode: next.mode,
    scales,
    freeIds: new Set(freeScales.map((s) => s.id)),
    fixedValues,
  });

  const values = { ...plan.values };
  const { weights } = weightMap(scales, next.mode);
  const totalOf = () => {
    const probe = { ...item, scores: { ...item.scores, ...values } };
    return itemTotal(probe, next);
  };

  // страховка: втягиваем итог в интервал, обосновывающий позицию.
  // Нижняя граница (правый сосед / минимум зоны) — она же цель: при равенстве
  // порядок задаёт order, поэтому итог минимален и никогда не дотягивается до левого.
  // Верхняя граница (левый сосед / максимум зоны) не даёт перепрыгнуть соседей слева.
  // Шаги не перепрыгивают через интервал: если в него нельзя попасть из-за крупной
  // сетки шагов, остаётся ближайшее достижимое значение.
  let lo = lower;
  let hi = upper;
  if (lo > hi) {
    lo = target; // противоречивые соседи — держим цель
    hi = target;
  }
  for (let guard = 0; guard < 500; guard += 1) {
    const t = totalOf();
    if (t === null || t >= lo - 1e-7) break;
    const step = pickStep(values, freeScales, weights, 1);
    if (!step || t + step.delta > hi + 1e-7) break;
    values[step.id] = step.nv;
  }
  for (let guard = 0; guard < 500; guard += 1) {
    const t = totalOf();
    if (t === null || t <= hi + 1e-7) break;
    const step = pickStep(values, freeScales, weights, -1);
    if (!step || t + step.delta < lo - 1e-7) break;
    values[step.id] = step.nv;
  }

  item.scores = { ...item.scores, ...values };
  for (const s of freeScales) item.scores[s.id] = snapToStep(item.scores[s.id], s);
  item.manual = false; // положение обосновано баллами
  applyOrder();

  const actual = itemTotal(item, next);
  const landedZone = next.zones[zoneIndexForTotal(actual, next.zones)];
  item.zoneId = landedZone ? landedZone.id : zoneId;
  return {
    state: next,
    info: {
      ok: true,
      adjusted: true,
      target,
      actual,
      zoneId: landedZone ? landedZone.id : null,
      message:
        landedZone && landedZone.id !== zoneId
          ? `Баллы замороженных шкал не позволяют попасть в зону «${zone.name}» — элемент оказался в «${landedZone.name}»`
          : null,
    },
  };
}

/**
 * Целевой балл для позиции (используется в тестах и подсказках).
 */
export function targetTotalFor(state, zoneId, listWithoutItem, index) {
  const zone = (state.zones || []).find((z) => z.id === zoneId);
  if (!zone) return null;
  const rightId = listWithoutItem[index];
  if (rightId) {
    const right = (state.items || []).find((i) => i.id === rightId);
    const t = itemTotal(right, state);
    if (t !== null) return clamp(t, zone.min, zone.max);
  }
  return zone.min;
}

/** Режим расчёта по умолчанию / валидация. */
export const normalizeMode = (mode) => (mode === MODE_AVG ? MODE_AVG : MODE_SUM);
