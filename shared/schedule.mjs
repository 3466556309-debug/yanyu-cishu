const DAY_MS = 86400000;

export const RATINGS = ['known', 'fuzzy', 'forgotten'];

export function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number));
}

/** 用使用者当地日期生成 YYYY-MM-DD，避免跨时区把“今天”算错。 */
export function localDay(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDayString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time);
}

export function addDays(day, amount) {
  if (!isDayString(day)) throw new Error('日期格式不正确');
  const time = Date.parse(`${day}T00:00:00Z`) + Math.round(amount) * DAY_MS;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function defaultProgress(wordId) {
  return {
    wordId,
    status: 'new',
    dueDate: null,
    intervalDays: 0,
    ease: 2.3,
    streak: 0,
    lapses: 0,
    learnedAt: null,
    learnedDay: null,
    lastRating: null,
    lastReviewedAt: null,
    updatedAt: null,
  };
}

/**
 * 常见间隔重复做法：
 * - 认识：间隔按熟练度拉长，首次 3 天；
 * - 模糊：间隔减半，至少 1 天；
 * - 忘记：重来，1 天后再见。
 */
export function nextSchedule(previous, rating, day) {
  const base = { ...defaultProgress(previous?.wordId || ''), ...(previous || {}) };
  const wasNew = !base.learnedAt;
  let intervalDays;
  let ease = Number(base.ease) || 2.3;
  let streak = Number(base.streak) || 0;
  let lapses = Number(base.lapses) || 0;

  if (rating === 'known') {
    if (wasNew) {
      intervalDays = 3;
    } else {
      intervalDays = clamp(Math.round(Math.max(base.intervalDays || 1, 1) * ease), 2, 180);
    }
    ease = clamp(ease + 0.08, 1.3, 2.8);
    streak += 1;
  } else if (rating === 'fuzzy') {
    intervalDays = wasNew ? 1 : clamp(Math.round((base.intervalDays || 1) * 0.5), 1, 90);
    ease = clamp(ease - 0.15, 1.3, 2.8);
    streak = 0;
  } else {
    intervalDays = 1;
    ease = clamp(ease - 0.25, 1.3, 2.8);
    streak = 0;
    lapses += 1;
  }

  const status = rating === 'known' && streak >= 4
    ? 'mastered'
    : intervalDays >= 2
      ? 'review'
      : 'learning';

  return {
    ...base,
    status,
    dueDate: addDays(day, intervalDays),
    intervalDays,
    ease: Math.round(ease * 100) / 100,
    streak,
    lapses,
    learnedAt: base.learnedAt || new Date().toISOString(),
    learnedDay: base.learnedDay || day,
    lastRating: rating,
    lastReviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
