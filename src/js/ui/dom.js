/**
 * Небольшие DOM-хелперы: создание элементов, тосты, всплывающие окна,
 * inline-редактирование, точечный рендер списков без потери фокуса.
 */

/** Создание элемента: el('div', {class:'x', onclick: fn}, [children|string]) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'object') node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Формат чисел: без хвостовых нулей, максимум 4 знака после запятой. */
export function fmt(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(rounded).replace('.', ',');
}

/** Короткий формат для бейджей. */
export const fmtShort = (value) => fmt(value, 2);

/** Склонение: plural(5, 'элемент', 'элемента', 'элементов'). */
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/* ------------------------------ уведомления ------------------------------ */

export function toast(message, type = 'info', timeout = 4200) {
  const root = document.getElementById('toasts');
  if (!root) return () => {};
  const node = el('div', { class: `toast is-${type}` }, [message]);
  root.append(node);
  const remove = () => node.remove();
  const timer = setTimeout(remove, timeout);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}

/* ------------------------------ всплывающие окна ------------------------------ */

/**
 * Показывает всплывающую карточку рядом с якорем.
 * Возвращает объект с методом close().
 */
export function openPopover({ anchor, content, className = '', onClose, width = 380, placement = 'auto' }) {
  const root = document.getElementById('popover-root');
  const pop = el('div', { class: `popover ${className}`.trim(), style: { width: `${width}px` } }, [content]);
  root.append(pop);

  const reposition = () => {
    if (!anchor || !anchor.isConnected) return;
    const a = anchor.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const margin = 10;
    let left = a.left;
    if (placement === 'right' || (placement === 'auto' && a.right + p.width + margin < window.innerWidth)) left = a.right + margin;
    if (left + p.width > window.innerWidth - margin) left = window.innerWidth - p.width - margin;
    if (left < margin) left = margin;
    let top = a.top;
    if (top + p.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - p.height - margin);
    if (top < margin) top = margin;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };

  const close = () => {
    observer.disconnect();
    window.removeEventListener('resize', reposition);
    document.removeEventListener('scroll', reposition, true);
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    pop.remove();
    if (onClose) onClose();
  };

  function onDocMouseDown(ev) {
    if (!pop.contains(ev.target) && !(anchor && anchor.contains(ev.target))) close();
  }
  function onKeyDown(ev) {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
    }
  }

  // следим за изменениями разметки: перерисовка списка может сдвинуть якорь
  const observer = new MutationObserver(() => {
    if (!pop.isConnected) return;
    reposition();
  });

  reposition();
  requestAnimationFrame(reposition);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  return { el: pop, close, reposition };
}

/* ------------------------------ редактирование ------------------------------ */

/** Ширина input по длине текста (в ch). */
export const inputWidth = (text, min = 3, max = 40) => `${Math.min(max, Math.max(min, String(text ?? '').length + 1))}ch`;

/** Классы для «наложения» поля ввода на редактируемый элемент. */
export const EDITING_CLASS = 'is-editing';

/**
 * Превращает элемент в поле ввода «на месте»: клик — редактирование,
 * Enter/blur — сохранить, Esc — отменить. onCommit вызывается только при изменении.
 */
export function inlineEdit(host, { value, className = '', isRange = false, onCommit, onCancel, selectAll = true }) {
  const input = el('input', {
    class: `inline-input ${className}`.trim(),
    type: 'text',
    value: String(value ?? ''),
    spellcheck: false,
  });
  if (isRange) input.classList.add('is-range');
  // поле ввода рисуется поверх хозяина: сам узел остаётся в DOM,
  // поэтому перерисовка состояния не ломает редактирование
  host.classList.add('is-editing');
  host.append(input);
  input.focus();
  if (selectAll) input.select();
  let done = false;
  const finish = () => {
    input.remove();
    host.classList.remove('is-editing');
  };
  const commit = () => {
    if (done) return;
    done = true;
    const next = input.value;
    finish();
    try {
      onCommit?.(next);
    } catch (err) {
      console.error(err);
    }
  };
  const cancel = () => {
    if (done) return;
    done = true;
    finish();
    onCancel?.();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', commit);
  return input;
}

/**
 * Точечная синхронизация списка DOM-узлов по ключу.
 * Позволяет обновлять состояние без потери фокуса и позиции прокрутки.
 */
export function reconcile(container, items, { key, create, update }) {
  const existing = new Map();
  for (const node of [...container.children]) {
    if (node.dataset.key) existing.set(node.dataset.key, node);
  }
  let prev = null;
  for (const item of items) {
    const k = String(key(item));
    let node = existing.get(k);
    if (node) {
      existing.delete(k);
      const ref = prev ? prev.nextSibling : container.firstChild;
      if (node !== ref) container.insertBefore(node, ref);
    } else {
      node = create(item);
      node.dataset.key = k;
      const ref = prev ? prev.nextSibling : container.firstChild;
      container.insertBefore(node, ref);
    }
    update?.(node, item);
    prev = node;
  }
  for (const node of existing.values()) node.remove();
}

/** Прокрутка элемента в зону видимости внутри контейнера. */
export function scrollIntoViewIfNeeded(node, container) {
  if (!node || !container) return;
  const n = node.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  if (n.top < c.top) container.scrollTop -= c.top - n.top + 8;
  else if (n.bottom > c.bottom) container.scrollTop += n.bottom - c.bottom + 8;
}

/** Проверка: пользователь сейчас что-то печатает? */
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
