export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function attr(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

export function uid(prefix = 'op') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatDateCN(day, options = {}) {
  if (!day) return '';
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  const week = '日一二三四五六'[date.getDay()];
  if (options.short) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getMonth() + 1}月${date.getDate()}日 · 周${week}`;
}

export function formatDateTimeCN(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function plural(count, unit) {
  return `${count} ${unit}`;
}

export function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseRoute(hash = location.hash) {
  const clean = String(hash || '').replace(/^#\/?/, '');
  const parts = clean.split('/').filter(Boolean);
  return { name: parts[0] || 'home', id: parts[1] || '', tail: parts[2] || '' };
}

export function highlightTerm(text, term) {
  if (!text) return '';
  if (!term) return escapeHtml(text);
  const index = text.indexOf(term);
  if (index < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(term)}</mark>${escapeHtml(text.slice(index + term.length))}`;
}

export function todayISO() {
  return new Date().toISOString();
}

export function dateFromNow(amount, unit = 'day') {
  const date = new Date();
  if (unit === 'day') date.setDate(date.getDate() + amount);
  return date;
}

export function initials(username) {
  const value = String(username || '学').trim();
  return value.slice(0, 1) || '学';
}

export function isOnline() {
  return navigator.onLine !== false;
}
