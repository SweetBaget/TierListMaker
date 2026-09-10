import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scoring = await import('../src/js/scoring.js');
const { Store, reloadRanges } = await import('../src/js/store.js');
const { exportPayload, parseImported } = await import('../src/js/serialize.js');
const { createDefaultState, MODE_AVG, MODE_SUM } = await import('../src/js/constants.js');

const approx = (actual, expected, eps = 1e-5) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected}`);

const freshStore = (mutate) => {
  const store = new Store(createDefaultState());
  if (mutate) store.update(mutate);
  return store;
};

test('общий диапазон баллов считается по включённым шкалам', () => {
  const st = freshStore().state;
  const r = scoring.globalRange(st);
  assert.equal(r.min, 0);
  assert.equal(r.max, 10 * 2 + 5 * 1 + 100 * 0.5);

  const avg = { ...st, mode: MODE_AVG };
  const ra = scoring.globalRange(avg);
  approx(ra.max, (10 * 2 + 5 * 1 + 100 * 0.5) / 3.5);
});

test('верхняя зона заканчивается максимумом, нижняя начинается с минимума', () => {
  const st = freshStore().state;
  const zones = st.zones;
  assert.equal(zones[0].max, 75);
  assert.equal(zones[zones.length - 1].min, 0);
  assert.deepEqual(
    zones.map((z) => [z.min, z.max]),
    [
      [60, 75],
      [45, 60],
      [30, 45],
      [15, 30],
      [0, 15],
    ]
  );
});

test('при выключении шкалы диапазон и зоны пересчитываются', () => {
  const store = freshStore();
  const heavy = store.state.scales[0]; // вес 2 -> 20 баллов
  store.toggleScale(heavy.id, false);
  const r = scoring.globalRange(store.state);
  assert.equal(r.max, 5 * 1 + 100 * 0.5);
  assert.equal(store.state.zones[0].max, r.max);
  assert.equal(store.state.zones.at(-1).min, r.min);

  store.toggleScale(heavy.id, true);
  assert.equal(scoring.globalRange(store.state).max, 75);
});

test('«только я» оставляет включённой одну шкалу', () => {
  const store = freshStore();
  const [a, b, c] = store.state.scales;
  store.onlyScale(c.id);
  assert.equal(scoring.globalRange(store.state).max, c.max * c.weight);
  assert.deepEqual(
    store.state.scales.map((s) => s.enabled),
    [false, false, true]
  );
  store.onlyScale(a.id);
  assert.equal(scoring.globalRange(store.state).max, 20);
  assert.equal(scoring.globalRange(store.state).min, 0);
  void b;
});

test('элемент попадает в зону по своему баллу', () => {
  const store = freshStore((s) => {
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 10, 'sc-useful': 5, 'sc-looks': 100 }, frozen: {}, order: 0 });
    s.items.push({ id: 'i2', text: 'B', image: null, scores: { 'sc-quality': 5, 'sc-useful': 0, 'sc-looks': 0 }, frozen: {}, order: 1 });
  });
  const rows = scoring.layout(store.state);
  assert.equal(rows[0].items.length, 1);
  assert.equal(rows[0].items[0].item.id, 'i1'); // 20+5+50 = 75 -> зона A (60..75)
  assert.equal(rows[0].items[0].total, 75);
  const zoneE = rows[4].items.map((e) => e.item.id);
  assert.deepEqual(zoneE, ['i2']); // 5*2 = 10 -> зона E (0..15)
});

test('средний балл делится на сумму весов', () => {
  const store = freshStore((s) => {
    s.mode = MODE_AVG;
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 10, 'sc-useful': 5, 'sc-looks': 100 }, frozen: {}, order: 0 });
  });
  approx(scoring.itemTotal(store.state.items[0], store.state), (10 * 2 + 5 * 1 + 100 * 0.5) / 3.5);
});

test('нулевой вес исключает шкалу из суммы', () => {
  const store = freshStore((s) => {
    s.scales[0].weight = 0;
    s.scales[1].weight = 0;
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 10, 'sc-useful': 5, 'sc-looks': 100 }, frozen: {}, order: 0 });
  });
  assert.equal(scoring.itemTotal(store.state.items[0], store.state), 50);
});

test('сортировка внутри зоны — по убыванию баллов', () => {
  const store = freshStore((s) => {
    s.items.push({ id: 'low', text: 'L', image: null, scores: { 'sc-quality': 0 }, frozen: {}, order: 0 });
    s.items.push({ id: 'high', text: 'H', image: null, scores: { 'sc-quality': 10 }, frozen: {}, order: 1 });
    s.items.push({ id: 'mid', text: 'M', image: null, scores: { 'sc-quality': 5 }, frozen: {}, order: 2 });
  });
  const rows = scoring.layout(store.state);
  const ids = rows.flatMap((r) => r.items.map((e) => e.item.id));
  const totals = rows.flatMap((r) => r.items.map((e) => e.total));
  const sorted = [...totals].sort((a, b) => b - a);
  assert.deepEqual(totals, sorted);
  assert.deepEqual(ids, ['high', 'mid', 'low']);
});

test('перемещение вручную подстраивает баллы до нужной зоны', () => {
  const store = freshStore();
  store.state.scales.forEach((s) => (s.weight = 1));
  store.update((s) => {
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 0 }, frozen: {}, order: 0 });
  });
  const target = store.state.zones[2]; // зона C
  const info = store.moveItem('i1', target.id, 0);
  assert.equal(info.ok, true);
  const item = store.state.items[0];
  const total = scoring.itemTotal(item, store.state);
  assert.ok(total >= target.min, `${total} >= ${target.min}`);
  assert.ok(total <= target.max, `${total} <= ${target.max}`);
  assert.equal(scoring.zoneIndexForTotal(total, store.state.zones), 2);
});

test('перемещение влево от правого соседа: балл равен соседу (или ближайший снизу)', () => {
  const store = freshStore((s) => {
    s.scales.forEach((sc) => {
      sc.weight = 1;
    });
    s.items.push({ id: 'right', text: 'R', image: null, scores: { 'sc-quality': 6, 'sc-useful': 0, 'sc-looks': 0 }, frozen: {}, order: 0 });
    s.items.push({ id: 'me', text: 'M', image: null, scores: { 'sc-quality': 0, 'sc-useful': 0, 'sc-looks': 0 }, frozen: {}, order: 1 });
  });
  const zone = store.state.zones[4]; // 0..23, там же где right (6)
  const rightTotal = 6;
  const info = store.moveItem('me', zone.id, 0);
  assert.equal(info.ok, true);
  assert.equal(info.target, rightTotal);
  const meTotal = scoring.itemTotal(store.state.items.find((i) => i.id === 'me'), store.state);
  assert.ok(meTotal <= rightTotal + 1e-7, `${meTotal} <= ${rightTotal}`);
  assert.ok(meTotal > rightTotal - 15, 'балл не должен проваливаться слишком низко');
  const rows = scoring.layout(store.state);
  assert.deepEqual(
    rows[4].items.map((e) => e.item.id),
    ['me', 'right']
  );
});

test('между соседями берётся балл правого — минимальный обосновывающий', () => {
  const store = freshStore((s) => {
    s.scales.forEach((sc) => {
      sc.enabled = sc.id === 'sc-quality';
      sc.weight = 1;
    });
    s.items.push({ id: 'left', text: 'L', image: null, scores: { 'sc-quality': 7 }, frozen: {}, order: 0 });
    s.items.push({ id: 'right', text: 'R', image: null, scores: { 'sc-quality': 6 }, frozen: {}, order: 1 });
    s.items.push({ id: 'me', text: 'M', image: null, scores: { 'sc-quality': 0 }, frozen: {}, order: 2 });
  });
  const zoneB = store.state.zones[1]; // 6..8
  const info = store.moveItem('me', zoneB.id, 1); // между left(7) и right(6)
  assert.equal(info.target, 6);
  const meTotal = scoring.itemTotal(store.state.items.find((i) => i.id === 'me'), store.state);
  assert.equal(meTotal, 6, 'итог равен правому соседу, а не дотягивается до левого');
  assert.deepEqual(
    scoring.layout(store.state)[1].items.map((e) => e.item.id),
    ['left', 'me', 'right']
  );
});

test('в конец зоны ставится минимум зоны, а не балл левого соседа', () => {
  const store = freshStore((s) => {
    s.scales.forEach((sc) => {
      sc.enabled = sc.id === 'sc-quality';
      sc.weight = 1;
    });
    s.items.push({ id: 'x', text: 'X', image: null, scores: { 'sc-quality': 3 }, frozen: {}, order: 0 });
    s.items.push({ id: 'me', text: 'M', image: null, scores: { 'sc-quality': 0 }, frozen: {}, order: 1 });
  });
  const zoneD = store.state.zones[3]; // 2..4
  const info = store.moveItem('me', zoneD.id, 1); // после x(3), справа никого
  assert.equal(info.target, 2);
  const meTotal = scoring.itemTotal(store.state.items.find((i) => i.id === 'me'), store.state);
  assert.equal(meTotal, 2, 'итог равен минимуму зоны, а не левому соседу');
  assert.deepEqual(
    scoring.layout(store.state)[3].items.map((e) => e.item.id),
    ['x', 'me']
  );
});

test('план ниже правого соседа подтягивается вверх до достижимого минимума', () => {
  const store = freshStore((s) => {
    s.scales.forEach((sc) => {
      sc.enabled = sc.id === 'sc-quality' || sc.id === 'sc-looks';
      sc.weight = 1;
    });
    // right: 6 + 0 = 6; у me заморожено 2, свободная шкала с шагом 5: достижимо 2, 7, 12, …
    s.items.push({ id: 'right', text: 'R', image: null, scores: { 'sc-quality': 6, 'sc-looks': 0 }, frozen: {}, order: 0 });
    s.items.push({ id: 'me', text: 'M', image: null, scores: { 'sc-quality': 2 }, frozen: { 'sc-quality': true }, order: 1 });
  });
  const zoneE = store.state.zones[4]; // 0..22
  const info = store.moveItem('me', zoneE.id, 0); // слева от right(6)
  assert.equal(info.target, 6);
  const meTotal = scoring.itemTotal(store.state.items.find((i) => i.id === 'me'), store.state);
  assert.equal(meTotal, 7, 'ровно 6 недостижимо — взят ближайший достижимый минимум 7');
  assert.deepEqual(
    scoring.layout(store.state)[4].items.map((e) => e.item.id),
    ['me', 'right']
  );
});

test('балл не опускается ниже минимума зоны', () => {
  const store = freshStore((s) => {
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 10, 'sc-useful': 5, 'sc-looks': 100 }, frozen: {}, order: 0 });
  });
  const bottom = store.state.zones.at(-1);
  store.moveItem('i1', bottom.id, 0);
  const item = store.state.items[0];
  const total = scoring.itemTotal(item, store.state);
  assert.ok(total >= bottom.min - 1e-6);
  assert.ok(total <= bottom.max + 1e-6);
});

test('замороженные шкалы не меняются при перемещении', () => {
  const store = freshStore();
  store.update((s) => {
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 4, 'sc-useful': 2, 'sc-looks': 50 }, frozen: { 'sc-useful': true }, order: 0 });
  });
  store.moveItem('i1', store.state.zones[4].id, 0);
  const item = store.state.items[0];
  assert.equal(item.scores['sc-useful'], 2);
  const freeChanged = item.scores['sc-quality'] !== 4 || item.scores['sc-looks'] !== 50;
  assert.ok(freeChanged, 'свободные шкалы должны были измениться');
});

test('если заморожены все шкалы, баллы не меняются', () => {
  const store = freshStore();
  store.update((s) => {
    const frozen = {};
    s.scales.forEach((sc) => {
      frozen[sc.id] = true;
    });
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 10, 'sc-useful': 0, 'sc-looks': 0 }, frozen, order: 0 });
  });
  const before = { ...store.state.items[0].scores };
  const info = store.moveItem('i1', store.state.zones[4].id, 0);
  assert.equal(info.adjusted, false);
  assert.equal(info.reason, 'frozen');
  assert.deepEqual(store.state.items[0].scores, before);
});

test('если шкал нет вовсе, положение задаётся вручную', () => {
  const store = freshStore((s) => {
    s.scales.forEach((sc) => {
      sc.enabled = false;
    });
    s.items.push({ id: 'i1', text: 'A', image: null, scores: {}, frozen: {}, order: 0 });
    s.items.push({ id: 'i2', text: 'B', image: null, scores: {}, frozen: {}, order: 1 });
  });
  const info = store.moveItem('i1', store.state.zones[3].id, 0);
  assert.equal(info.reason, 'no-scales');
  const rows = scoring.layout(store.state);
  assert.deepEqual(
    rows[3].items.map((e) => e.item.id),
    ['i1']
  );
  assert.deepEqual(
    rows[4].items.map((e) => e.item.id),
    ['i2']
  );
  assert.equal(scoring.layout(store.state).flatMap((r) => r.items).length, 2);
});

test('шаг шкалы соблюдается при авто-подстройке', () => {
  const store = freshStore();
  store.update((s) => {
    s.items.push({ id: 'i1', text: 'A', image: null, scores: {}, frozen: {}, order: 0 });
  });
  store.moveItem('i1', store.state.zones[2].id, 0);
  const item = store.state.items[0];
  for (const scale of store.state.scales) {
    const v = item.scores[scale.id];
    const steps = (v - scale.min) / scale.step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${scale.name}: ${v} не кратно шагу ${scale.step}`);
  }
});

test('экспорт и импорт сохраняют тир-лист', () => {
  const store = freshStore();
  store.update((s) => {
    s.title = 'Тест';
    s.mode = MODE_AVG;
    s.zones[0].name = 'S+';
    s.items.push({ id: 'i1', text: 'Меч', image: null, scores: { 'sc-quality': 8 }, frozen: { 'sc-quality': true }, order: 0 });
  });
  const json = JSON.stringify(exportPayload(store.state));
  const parsed = parseImported(json);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.title, 'Тест');
  assert.equal(parsed.state.mode, MODE_AVG);
  assert.equal(parsed.state.zones[0].name, 'S+');
  assert.equal(parsed.state.items[0].text, 'Меч');
  assert.equal(parsed.state.items[0].scores['sc-quality'], 8);
  assert.equal(parsed.state.items[0].frozen['sc-quality'], true);
  assert.deepEqual(
    parsed.state.scales.map((s) => s.name),
    store.state.scales.map((s) => s.name)
  );
});

test('импорт битого файла даёт понятную ошибку', () => {
  assert.equal(parseImported('{oops').ok, false);
  assert.equal(parseImported('{"hello":1}').ok, false);
  assert.ok(parseImported('{oops').errors[0].includes('JSON'));
});

test('импорт изображений (data URL) сохраняется как есть', () => {
  const state = createDefaultState();
  state.items.push({ id: 'i1', text: '', image: 'data:image/png;base64,AAA', scores: {}, frozen: {}, order: 0 });
  const parsed = parseImported(JSON.stringify(exportPayload(state)));
  assert.equal(parsed.state.items[0].image, 'data:image/png;base64,AAA');
});

test('пользовательские границы зон не сбиваются при пересчёте', () => {
  const store = freshStore();
  store.patchZone(store.state.zones[0].id, { min: 70 });
  store.patchZone(store.state.zones[1].id, { min: 50 });
  const before = store.state.zones.map((z) => ({ ...z }));
  const r = scoring.globalRange(store.state);
  const zones = scoring.normalizeZoneRanges(before, r, r);
  assert.equal(zones[0].max, r.max);
  assert.equal(zones.at(-1).min, r.min);
  assert.equal(zones[0].min, 70);
  assert.equal(zones[1].min, 50);
  assert.ok(zones[1].max < zones[0].min + 1e-6, 'зоны не должны пересекаться');
});

test('добавление зоны сохраняет верхние диапазоны', () => {
  const store = freshStore();
  const topBefore = { ...store.state.zones[0] };
  store.addZone('F');
  assert.equal(store.state.zones.length, 6);
  assert.equal(store.state.zones[0].max, topBefore.max);
  assert.equal(store.state.zones[0].min, topBefore.min);
  assert.equal(store.state.zones.at(-1).min, 0);
  const list = store.state.zones;
  for (let i = 1; i < list.length; i += 1) assert.equal(list[i].max, list[i - 1].min, 'зоны должны стыковаться');
});

test('перемещение зоны вверх меняет её место, границы остаются по позициям', () => {
  const store = freshStore();
  const [a, b] = store.state.zones;
  const bounds = store.state.zones.map((z) => [z.min, z.max]);
  store.moveZone(b.id, -1);
  assert.equal(store.state.zones[0].name, b.name);
  assert.equal(store.state.zones[1].name, a.name);
  assert.deepEqual(
    store.state.zones.map((z) => [z.min, z.max]),
    bounds
  );
});

test('изменение точки окончания шкалы расширяет диапазон и верхнюю зону', () => {
  const store = freshStore();
  const scale = store.state.scales[0];
  store.patchScale(scale.id, { max: 20 });
  const r = scoring.globalRange(store.state);
  assert.equal(r.max, 20 * 2 + 5 * 1 + 100 * 0.5);
  assert.equal(store.state.zones[0].max, r.max);
  assert.equal(store.state.zones.at(-1).min, r.min);
});

test('выключение всех шкал не ломает зоны', () => {
  const store = freshStore();
  store.update((s) => s.scales.forEach((sc) => (sc.enabled = false)));
  const r = scoring.globalRange(store.state);
  assert.deepEqual(r, { min: 0, max: 0, hasScales: false });
  assert.equal(store.state.zones.length, 5);
  assert.equal(scoring.itemTotal(store.state.items[0] ?? {}, store.state), null);
});

test('загрузка сохранённого состояния (localStorage) работает через migrate', () => {
  const restart = new Store(createDefaultState());
  restart.update((s) => {
    s.items.push({ id: 'i1', text: 'X', image: null, scores: {}, frozen: {}, order: 0 });
  });
  const saved = JSON.parse(JSON.stringify(restart.state));
  const reloaded = new Store(saved);
  assert.equal(reloaded.state.items.length, 1);
  assert.equal(reloaded.state.zones[0].max, reloaded.state.range.max);
});

test('файловая схема экспорта содержит читаемые отчёты', () => {
  const store = freshStore();
  store.update((s) => {
    s.items.push({ id: 'i1', text: 'Меч', image: null, scores: { 'sc-quality': 10, 'sc-useful': 5, 'sc-looks': 100 }, frozen: {}, order: 0 });
  });
  const payload = exportPayload(store.state);
  assert.equal(payload.schema, 'tierlistmaker/1');
  assert.equal(payload.items[0].total, 75);
  assert.equal(payload.items[0].breakdown.length, 3);
  assert.equal(payload.zones[0].items[0].id, 'i1');
  assert.equal(payload.activeScales.length, 3);
  JSON.parse(JSON.stringify(payload));
});

test('границы зон монотонны и внутри общего диапазона после серии правок', () => {
  const store = freshStore();
  store.patchZone(store.state.zones[0].id, { min: -100 });
  store.patchZone(store.state.zones.at(-1).id, { max: 1000 });
  store.patchZone(store.state.zones[2].id, { min: 1e9 });
  store.toggleScale(store.state.scales[1].id, false);
  const list = store.state.zones;
  const r = scoring.globalRange(store.state);
  for (const z of list) {
    assert.ok(z.min >= r.min - 1e-9 && z.max <= r.max + 1e-9, `${z.min}..${z.max} в ${r.min}..${r.max}`);
  }
  for (let i = 1; i < list.length; i += 1) assert.ok(list[i].max <= list[i - 1].min + 1e-9);
  assert.equal(list[0].max, r.max);
  assert.equal(list.at(-1).min, r.min);
});

test('reloadRanges с keepRanges сохраняет импортированные границы', () => {
  const state = createDefaultState();
  state.zones = state.zones.map((z, i) => ({ ...z, min: 100 - i * 20 - 20, max: 100 - i * 20 }));
  state.range = { min: 0, max: 100 };
  reloadRanges(state, true);
  assert.equal(state.zones[0].max, 75);
  assert.equal(state.zones.at(-1).min, 0);
});

test('состояние по умолчанию: 5 зон A..E и диапазон 0..75', () => {
  const st = createDefaultState();
  assert.deepEqual(
    st.zones.map((z) => z.name),
    ['A', 'B', 'C', 'D', 'E']
  );
  const store = new Store(st);
  assert.equal(store.state.range.max, 75);
  void readFileSync;
  void MODE_SUM;
});

test('повторное перемещение на то же место не меняет баллы', () => {
  const store = freshStore();
  store.update((s) => {
    s.items.push({ id: 'i1', text: 'A', image: null, scores: { 'sc-quality': 7 }, frozen: {}, order: 0, zoneId: s.zones[4].id });
  });
  const before = { ...store.state.items[0].scores };
  const zone = store.state.zones[4]; // элемент уже здесь, позиция не меняется
  const info = store.moveItem('i1', zone.id, 0);
  assert.equal(info.unchanged, true);
  assert.deepEqual(store.state.items[0].scores, before);
});

test('перенос в другую зону и обратно: соседи и порядок не ломаются', () => {
  const store = freshStore();
  store.update((s) => {
    s.scales.forEach((sc) => {
      sc.enabled = sc.id === 'sc-quality';
      sc.weight = 1;
    });
    s.items.push({ id: 'a', text: 'a', image: null, scores: { 'sc-quality': 2 }, frozen: {}, order: 0 });
    s.items.push({ id: 'b', text: 'b', image: null, scores: { 'sc-quality': 7 }, frozen: {}, order: 1 });
    s.items.push({ id: 'c', text: 'c', image: null, scores: { 'sc-quality': 10 }, frozen: {}, order: 2 });
  });
  const zones = store.state.zones; // A 8..10, B 6..8, C 4..6, D 2..4, E 0..2
  assert.deepEqual(
    scoring.layout(store.state).map((r) => r.items.map((e) => e.item.id)),
    [['c'], ['b'], [], ['a'], []]
  );

  // ставим 'c' в зону B на первое место: цель — балл правого соседа (7)
  const info = store.moveItem('c', zones[1].id, 0);
  assert.equal(info.target, 7);
  assert.deepEqual(
    scoring.layout(store.state)[1].items.map((e) => e.item.id),
    ['c', 'b']
  );

  // возвращаем 'c' в верхнюю зону: цель — минимум зоны (8)
  const back = store.moveItem('c', zones[0].id, 0);
  assert.equal(back.target, 8);
  assert.equal(scoring.itemTotal(store.state.items.find((i) => i.id === 'c'), store.state), 8);
  assert.deepEqual(
    scoring.layout(store.state)[0].items.map((e) => e.item.id),
    ['c']
  );
});
