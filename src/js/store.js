/**
 * Состояние приложения: мутации, подписки, localStorage.
 */

import {
  createDefaultState,
  makeScale,
  makeZone,
  SCHEMA,
  STORAGE_KEY,
  THEME_KEY,
  uid,
  ZONE_COLORS,
} from './constants.js';
import {
  activeScales,
  applyMove,
  clamp,
  evenZoneRanges,
  globalRange,
  layout,
  itemTotal,
  normalizeMode,
  normalizeZoneRanges,
  normScale,
  toNum,
} from './scoring.js';

export class Store {
  constructor(initial) {
    this.state = null;
    this.listeners = new Set();
    this.theme = 'dark';
    const base = initial || createDefaultState();
    this.set(reloadRanges(this.migrate(base)), { silent: true });
  }

  /** Приводит любой (в т.ч. импортированный) объект к валидному состоянию. */
  migrate(raw) {
    const def = createDefaultState();
    if (!raw || typeof raw !== 'object') return def;
    const state = {
      schema: SCHEMA,
      title: typeof raw.title === 'string' ? raw.title : def.title,
      mode: normalizeMode(raw.mode),
      autoAdjust: raw.autoAdjust !== false,
      scales: Array.isArray(raw.scales) ? raw.scales.map(normScale) : def.scales,
      zones: Array.isArray(raw.zones)
        ? raw.zones.map((z, i) => ({
            id: z?.id ? String(z.id) : uid('zone'),
            name: typeof z?.name === 'string' && z.name.length ? z.name : `Зона ${i + 1}`,
            color: typeof z?.color === 'string' && z.color ? z.color : ZONE_COLORS[i % ZONE_COLORS.length],
            min: toNum(z?.min, 0),
            max: toNum(z?.max, 0),
          }))
        : def.zones,
      items: Array.isArray(raw.items)
        ? raw.items.map((it) => ({
            id: it?.id ? String(it.id) : uid('item'),
            text: typeof it?.text === 'string' ? it.text : '',
            image: typeof it?.image === 'string' ? it.image : null,
            scores: it?.scores && typeof it.scores === 'object' ? { ...it.scores } : {},
            frozen: it?.frozen && typeof it.frozen === 'object' ? { ...it.frozen } : {},
            order: toNum(it?.order, 0),
            zoneId: it?.zoneId ? String(it.zoneId) : null,
            manual: it?.manual === true,
          }))
        : [],
      range: raw.range && typeof raw.range === 'object' ? { min: toNum(raw.range.min, 0), max: toNum(raw.range.max, 0) } : { min: 0, max: 0 },
    };
    if (!state.scales.length) state.scales = def.scales;
    if (!state.zones.length) state.zones = def.zones;
    return state;
  }

  /** Подписка на изменения. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  /** Установка состояния (с пересчётом диапазонов зон). silent — без уведомления подписчиков. */
  set(state, { silent = false, keepRanges = false } = {}) {
    const migrated = this.migrate(state);
    this.state = reloadRanges(migrated, keepRanges);
    if (!silent) this.emit();
    return this.state;
  }

  /** Точечное обновление (мутатор получает снимок состояния). */
  update(mutator, { silent = false, keepRanges = false } = {}) {
    const draft = structuredClone(this.state);
    mutator(draft);
    return this.set(draft, { silent, keepRanges });
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('Не удалось сохранить состояние:', err);
    }
  }

  static load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('Не удалось прочитать сохранённое состояние:', err);
      return null;
    }
  }

  static loadTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'dark';
    } catch {
      return 'dark';
    }
  }

  static saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------- шкалы ------------------------- */

  addScale() {
    return this.update((s) => {
      const scale = makeScale(s.scales.length);
      s.scales.push(scale);
      s.items.forEach((it) => {
        it.scores[scale.id] = scale.min;
      });
    });
  }

  patchScale(id, patch) {
    return this.update((s) => {
      const scale = s.scales.find((x) => x.id === id);
      if (!scale) return;
      const before = { ...scale };
      Object.assign(scale, patch);
      const next = normScale(scale);
      Object.assign(scale, next);
      // если изменились границы/шаг — подтягиваем баллы элементов
      if (before.min !== scale.min || before.max !== scale.max || before.step !== scale.step) {
        s.items.forEach((it) => {
          const v = clamp(toNum(it.scores[id], scale.min), scale.min, scale.max);
          it.scores[id] = scale.step > 0 ? clamp(scale.min + Math.round((v - scale.min) / scale.step) * scale.step, scale.min, scale.max) : v;
        });
      }
    });
  }

  removeScale(id) {
    return this.update((s) => {
      if (s.scales.length <= 1) return;
      s.scales = s.scales.filter((x) => x.id !== id);
      s.items.forEach((it) => {
        delete it.scores[id];
        delete it.frozen[id];
      });
    });
  }

  toggleScale(id, enabled) {
    return this.update((s) => {
      const scale = s.scales.find((x) => x.id === id);
      if (scale) scale.enabled = enabled === undefined ? !scale.enabled : Boolean(enabled);
    });
  }

  /** «Только я» — оставить включённой одну шкалу. */
  onlyScale(id) {
    return this.update((s) => {
      s.scales.forEach((x) => {
        x.enabled = x.id === id;
      });
    });
  }

  /* ------------------------- зоны ------------------------- */

  /** Новая зона добавляется снизу: нижняя зона делится пополам, остальные не трогаем. */
  addZone(name) {
    return this.update((s) => {
      const range = globalRange(s);
      const zone = makeZone(name || `Зона ${s.zones.length + 1}`, ZONE_COLORS[s.zones.length % ZONE_COLORS.length]);
      const last = s.zones[s.zones.length - 1];
      const mid = Math.round(((toNum(last.min, range.min) + toNum(last.max, range.max)) / 2) * 1e4) / 1e4;
      last.min = mid;
      zone.min = range.min;
      zone.max = mid;
      s.zones.push(zone);
      s.range = { min: range.min, max: range.max };
      clampZoneBounds(s);
    });
  }

  /** Удаление зоны: её диапазон переходит соседу. */
  removeZone(id) {
    return this.update((s) => {
      if (s.zones.length <= 1) return;
      const i = s.zones.findIndex((z) => z.id === id);
      if (i < 0) return;
      const [removed] = s.zones.splice(i, 1);
      if (i === 0 && s.zones.length) s.zones[0].max = removed.max;
      else if (s.zones[i - 1]) s.zones[i - 1].min = removed.min;
      clampZoneBounds(s);
    });
  }

  /**
   * Правка зоны. Зоны стыкуются друг с другом, поэтому изменение нижней границы зоны
   * сдвигает верхнюю границу зоны под ней (и наоборот).
   */
  patchZone(id, patch) {
    return this.update((s) => {
      const i = s.zones.findIndex((z) => z.id === id);
      if (i < 0) return;
      const zone = s.zones[i];
      const below = s.zones[i + 1];
      const above = s.zones[i - 1];
      const range = globalRange(s);
      if (patch.name !== undefined) zone.name = String(patch.name);
      if (patch.color !== undefined) zone.color = String(patch.color);
      if (patch.min !== undefined) {
        const v = clamp(toNum(patch.min, zone.min), below ? below.min : range.min, zone.max);
        zone.min = v;
        if (below) {
          below.max = v;
          if (below.min > v) below.min = v;
        }
      }
      if (patch.max !== undefined) {
        const v = clamp(toNum(patch.max, zone.max), zone.min, above ? above.max : range.max);
        zone.max = v;
        if (above) {
          above.min = v;
          if (above.max < v) above.max = v;
        }
      }
      clampZoneBounds(s);
    });
  }

  /**
   * Перемещение зоны вверх/вниз. Диапазоны соответствуют позициям (верхняя зона — самая
   * высокая), поэтому меняем местами только название и цвет.
   */
  moveZone(id, dir) {
    return this.update((s) => {
      const i = s.zones.findIndex((z) => z.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.zones.length) return;
      const a = s.zones[i];
      const b = s.zones[j];
      [a.name, b.name] = [b.name, a.name];
      [a.color, b.color] = [b.color, a.color];
    });
  }

  /* ------------------------- элементы ------------------------- */

  addItem({ text = '', image = null } = {}) {
    return this.update((s) => {
      const item = {
        id: uid('item'),
        text,
        image,
        scores: {},
        frozen: {},
        order: s.items.length,
        zoneId: s.zones[s.zones.length - 1]?.id || null,
      };
      activeScales(s).forEach((sc) => {
        item.scores[sc.id] = sc.min;
      });
      s.items.push(item);
    });
  }

  removeItem(id) {
    return this.update((s) => {
      s.items = s.items.filter((i) => i.id !== id);
    });
  }

  patchItem(id, patch) {
    return this.update((s) => {
      const item = s.items.find((i) => i.id === id);
      if (item) Object.assign(item, patch);
    });
  }

  /** Ручное изменение балла по шкале. */
  setScore(id, scaleId, value) {
    return this.update((s) => {
      const item = s.items.find((i) => i.id === id);
      const scale = activeScales(s).find((x) => x.id === scaleId);
      if (!item || !scale) return;
      let v = clamp(toNum(value, scale.min), scale.min, scale.max);
      if (scale.step > 0) v = clamp(scale.min + Math.round((v - scale.min) / scale.step) * scale.step, scale.min, scale.max);
      item.scores[scaleId] = Math.round(v * 1e6) / 1e6;
    });
  }

  toggleFrozen(itemId, scaleId) {
    return this.update((s) => {
      const item = s.items.find((i) => i.id === itemId);
      if (!item) return;
      item.frozen = item.frozen || {};
      if (item.frozen[scaleId]) delete item.frozen[scaleId];
      else item.frozen[scaleId] = true;
    });
  }

  /**
   * Ручное закрепление элемента в зоне без изменения баллов
   * (используется, когда авто-подстройка выключена).
   */
  placeItemManually(itemId, zoneId, index) {
    return this.update((s) => {
      const item = s.items.find((i) => i.id === itemId);
      const zoneIdx = s.zones.findIndex((z) => z.id === zoneId);
      if (!item || zoneIdx < 0) return;
      item.manual = true;
      item.zoneId = zoneId;
      const rows = layout(s);
      const order = new Map();
      rows.forEach((row, zi) => {
        const ids = row.items.map((e) => e.item.id).filter((id) => id !== itemId);
        if (zi === zoneIdx) ids.splice(clamp(Math.round(toNum(index, 0)), 0, ids.length), 0, itemId);
        ids.forEach((id, i) => order.set(id, i));
      });
      order.set(itemId, order.get(itemId) ?? 0);
      s.items.forEach((it) => {
        if (order.has(it.id)) it.order = order.get(it.id);
      });
    });
  }

  /** Снять ручное закрепление: положение снова считается по баллам. */
  unpinItem(itemId) {
    return this.update((s) => {
      const item = s.items.find((i) => i.id === itemId);
      if (item) item.manual = false;
    });
  }

  /** Перемещение элемента с авто-подстройкой баллов. */
  moveItem(itemId, zoneId, index) {
    let info = { ok: false };
    this.update((s) => {
      const res = applyMove(s, itemId, zoneId, index);
      Object.assign(s, res.state);
      info = res.info;
    });
    return info;
  }

  /** Выровнять зоны: поровну поделить общий диапазон. */
  evenZones() {
    return this.update((s) => {
      s.zones = evenZoneRanges(s.zones, globalRange(s));
    });
  }

  /** Синхронизация порядка (order) с сортировкой по баллам — для ручного режима. */
  syncOrder() {
    return this.update((s) => {
      let order = 0;
      s.items
        .map((item) => ({ item, total: itemTotal(item, s) ?? -Infinity }))
        .sort((a, b) => b.total - a.total)
        .forEach(({ item }) => {
          item.order = order;
          order += 1;
        });
    });
  }

  /* ------------------------- режим ------------------------- */

  setMode(mode) {
    return this.update((s) => {
      s.mode = normalizeMode(mode);
    });
  }

  setTitle(title) {
    return this.update((s) => {
      s.title = String(title ?? '');
    });
  }

  setAutoAdjust(flag) {
    return this.update((s) => {
      s.autoAdjust = Boolean(flag);
    });
  }

  /** Сброс к состоянию по умолчанию. */
  reset() {
    return this.set(createDefaultState());
  }

  /** Полная замена (импорт). keepRanges — доверять диапазонам из файла. */
  replace(state, keepRanges = false) {
    return this.set(state, { keepRanges });
  }

  snapshot() {
    return structuredClone(this.state);
  }
}

/** Пересчёт диапазонов зон под актуальный набор включённых шкал. */
export function reloadRanges(state, keepRanges = false) {
  const range = globalRange(state);
  const prev = state.range || range;
  if (keepRanges) {
    const zones = state.zones.map((z) => ({ ...z }));
    if (zones.length) {
      zones[0].max = range.max;
      zones[zones.length - 1].min = range.min;
    }
    state.zones = zones;
    clampZoneBounds({ ...state, zones });
    state.range = { min: range.min, max: range.max };
    return state;
  }
  state.zones = normalizeZoneRanges(state.zones, range, prev);
  state.range = { min: range.min, max: range.max };
  return state;
}

/** Не даём границам выйти за общий диапазон и навести беспорядок. */
export function clampZoneBounds(state) {
  const range = globalRange(state);
  const zones = state.zones || [];
  const n = zones.length;
  if (!n) return state;

  for (const z of zones) {
    z.min = clamp(toNum(z.min, range.min), range.min, range.max);
    z.max = clamp(toNum(z.max, range.max), range.min, range.max);
    if (z.min > z.max) [z.min, z.max] = [z.max, z.min];
  }

  // сверху вниз: зона не может заходить выше верхней границы зоны над ней
  for (let i = 0; i < n; i += 1) {
    if (i === 0) zones[i].max = range.max;
    else zones[i].max = Math.min(zones[i].max, zones[i - 1].min);
    zones[i].min = Math.min(zones[i].min, zones[i].max);
  }
  // снизу вверх: нижняя зона начинается с минимума диапазона, остальные — не ниже зоны под ними
  for (let i = n - 1; i >= 0; i -= 1) {
    if (i === n - 1) zones[i].min = range.min;
    zones[i].min = Math.max(zones[i].min, i < n - 1 ? zones[i + 1].max : range.min);
    zones[i].max = Math.max(zones[i].max, zones[i].min);
  }
  // финальная фиксация верхней и нижней границ
  zones[0].max = range.max;
  zones[0].min = Math.min(zones[0].min, zones[0].max);
  zones[n - 1].min = range.min;
  zones[n - 1].max = Math.max(zones[n - 1].max, range.min);
  for (let i = 1; i < n; i += 1) {
    if (zones[i].max > zones[i - 1].min) zones[i].max = zones[i - 1].min;
    if (zones[i].min > zones[i].max) zones[i].min = zones[i].max;
  }
  return state;
}
