/**
 * Константы, значения по умолчанию и фабрика состояния тир-листа.
 */

export const SCHEMA = 'tierlistmaker/1';
export const STORAGE_KEY = 'tierlistmaker.state.v1';
export const THEME_KEY = 'tierlistmaker.theme';

export const MODE_SUM = 'sum'; // сумма баллов со всех включённых шкал
export const MODE_AVG = 'avg'; // средний балл по всем включённым шкалам

export const MODE_LABELS = {
  [MODE_SUM]: 'Сумма баллов',
  [MODE_AVG]: 'Средний балл',
};

/** Палитра зон (верхняя -> нижняя по кругу). */
export const ZONE_COLORS = [
  '#ff7f7f',
  '#ffbf7f',
  '#ffe066',
  '#a5e887',
  '#7fd1ff',
  '#b7a5ff',
  '#ff9fd6',
  '#8ff0d6',
];

export const DEFAULT_ZONE_NAMES = ['A', 'B', 'C', 'D', 'E'];

/** Шкалы по умолчанию: (0..10)x2 + (0..5)x1 + (0..100)x0.5 -> диапазон 0..75. */
export const DEFAULT_SCALES = () => [
  { id: 'sc-quality', name: 'Качество', min: 0, max: 10, step: 1, weight: 2, enabled: true },
  { id: 'sc-useful', name: 'Полезность', min: 0, max: 5, step: 0.5, weight: 1, enabled: true },
  { id: 'sc-looks', name: 'Внешний вид', min: 0, max: 100, step: 5, weight: 0.5, enabled: true },
];

let uidCounter = 0;

/** Уникальный идентификатор. */
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
}

/** Черновик зоны. */
export function makeZone(name, color) {
  return { id: uid('zone'), name, color, min: 0, max: 0 };
}

/** Черновик шкалы. */
export function makeScale(index = 0) {
  return {
    id: uid('sc'),
    name: `Шкала ${index + 1}`,
    min: 0,
    max: 10,
    step: 1,
    weight: 1,
    enabled: true,
  };
}

/**
 * Новое состояние приложения (диапазоны зон рассчитываются в store.js,
 * т.к. зависят от шкал).
 */
export function createDefaultState() {
  return {
    schema: SCHEMA,
    title: 'Мой тир-лист',
    mode: MODE_SUM,
    autoAdjust: true, // авто-подстройка баллов при ручном перемещении
    zones: DEFAULT_ZONE_NAMES.map((name, i) => makeZone(name, ZONE_COLORS[i % ZONE_COLORS.length])),
    scales: DEFAULT_SCALES(),
    items: [],
    range: { min: 0, max: 0 }, // последний известный диапазон баллов (для пропорц. пересчёта зон)
  };
}
