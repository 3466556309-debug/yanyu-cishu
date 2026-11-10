import { addDays, daysBetween, defaultProgress, localDay } from './schedule.mjs';

export { localDay };

export const TYPE_LABELS = { idiom: '成语', word: '实词' };
export const SCOPE_LABELS = { all: '混合', idiom: '成语', word: '实词' };
export const RATING_LABELS = { known: '认识', fuzzy: '模糊', forgotten: '忘记' };

export function activeWords(state) {
  return Object.values(state.words || {}).filter((word) => word && !word.deletedAt);
}

export function activeGroups(state) {
  return Object.values(state.groups || {}).filter((group) => group && !group.deletedAt);
}

export function wordProgress(state, wordId) {
  return { ...defaultProgress(wordId), ...(state.progress?.[wordId] || {}) };
}

export function isLearned(state, wordId) {
  return Boolean(state.progress?.[wordId]?.learnedAt);
}

export function isDue(state, wordId, day = localDay()) {
  const progress = state.progress?.[wordId];
  return Boolean(progress?.learnedAt && progress.dueDate && progress.dueDate <= day);
}

export function matchesScope(word, scope = 'all') {
  return scope === 'all' || word.type === scope;
}

export function dueWords(state, day = localDay(), scope = 'all') {
  return activeWords(state)
    .filter((word) => matchesScope(word, scope) && isDue(state, word.id, day))
    .sort((a, b) => {
      const dueCompare = String(state.progress[a.id]?.dueDate).localeCompare(String(state.progress[b.id]?.dueDate));
      if (dueCompare !== 0) return dueCompare;
      return a.id.localeCompare(b.id, 'zh-CN', { numeric: true });
    });
}

export function newWords(state, scope = 'all') {
  return activeWords(state)
    .filter((word) => matchesScope(word, scope) && !isLearned(state, word.id))
    .sort((a, b) => {
      const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      if (created !== 0) return created;
      return a.id.localeCompare(b.id, 'zh-CN', { numeric: true });
    });
}

export function newLearnedToday(state, day = localDay()) {
  return activeWords(state).filter((word) => state.progress?.[word.id]?.learnedDay === day).length;
}

export function remainingNewAllowance(state, day = localDay()) {
  return Math.max(0, Number(state.settings?.dailyNewLimit ?? 20) - newLearnedToday(state, day));
}

/**
 * 今日计划。当天清完模式给出全部到期复习；可留到后面模式按每日复习上限截取。
 */
export function todayPlan(state, day = localDay(), scope = state.settings?.scope || 'all') {
  const dueAll = dueWords(state, day, scope);
  const allowance = remainingNewAllowance(state, day);
  const newAll = newWords(state, scope);
  const reviewMode = state.settings?.reviewMode === 'flexible' ? 'flexible' : 'clear';
  const reviewCap = reviewMode === 'flexible' ? Math.max(0, Number(state.settings?.reviewDailyLimit ?? 30)) : dueAll.length;
  const due = dueAll.slice(0, reviewCap);
  const fresh = newAll.slice(0, allowance);
  return {
    day,
    scope,
    reviewMode,
    dueAll,
    due,
    dueRemaining: dueAll.slice(reviewCap),
    newAll,
    fresh,
    newRemaining: newAll.slice(allowance),
    allowance,
    total: due.length + fresh.length,
  };
}

export function groupsForWord(state, wordId) {
  return activeGroups(state).filter((group) => (group.wordIds || []).includes(wordId));
}

export function mistakeEntries(state) {
  return Object.values(state.mistakes || {})
    .filter((item) => item && item.active !== false && state.words?.[item.wordId] && !state.words[item.wordId].deletedAt)
    .sort((a, b) => String(b.lastWrongAt || '').localeCompare(String(a.lastWrongAt || '')))
    .map((item) => ({ ...item, word: state.words[item.wordId] }));
}

export function streakInfo(state, day = localDay()) {
  const days = Object.keys(state.checkins || {})
    .filter((key) => Number(state.checkins[key]?.total) > 0)
    .sort();
  if (!days.length) return { current: 0, longest: 0, days };
  const set = new Set(days);
  let current = 0;
  let cursor = set.has(day) ? day : addDays(day, -1);
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  let longest = 1;
  let run = 1;
  for (let index = 1; index < days.length; index += 1) {
    if (daysBetween(days[index - 1], days[index]) === 1) run += 1;
    else run = 1;
    if (run > longest) longest = run;
  }
  return { current, longest, days };
}

export function stats(state, day = localDay()) {
  const words = activeWords(state);
  const dueAll = dueWords(state, day, 'all');
  const learned = words.filter((word) => isLearned(state, word.id));
  const today = state.checkins?.[day] || { total: 0, newCount: 0, reviewCount: 0, knownCount: 0, fuzzyCount: 0, forgottenCount: 0 };
  const streak = streakInfo(state, day);
  const mistakes = mistakeEntries(state);
  const recent = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addDays(day, -offset);
    const item = state.checkins?.[date] || {};
    recent.push({
      date,
      total: Number(item.total) || 0,
      newCount: Number(item.newCount) || 0,
      reviewCount: Number(item.reviewCount) || 0,
      known: Number(item.knownCount) || 0,
      fuzzy: Number(item.fuzzyCount) || 0,
      forgotten: Number(item.forgottenCount) || 0,
    });
  }
  const thirtyDays = [];
  let recent30 = 0;
  let recent30Known = 0;
  let recent30All = 0;
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = addDays(day, -offset);
    const entry = state.checkins?.[date] || {};
    const total = Number(entry.total) || 0;
    if (offset < 28) thirtyDays.push({ date, total });
    recent30 += total;
    recent30All += total;
    recent30Known += Number(entry.knownCount) || 0;
  }
  return {
    totalWords: words.length,
    idiomCount: words.filter((word) => word.type === 'idiom').length,
    wordCount: words.filter((word) => word.type === 'word').length,
    learnedCount: learned.length,
    newCount: words.length - learned.length,
    dueCount: dueAll.length,
    dueToday: dueAll.filter((word) => state.progress[word.id]?.dueDate === day).length,
    overdue: dueAll.filter((word) => state.progress[word.id]?.dueDate < day).length,
    mistakeCount: mistakes.length,
    today,
    streak: streak.current,
    longestStreak: streak.longest,
    recent,
    thirtyDays,
    recent30,
    knownRate: recent30All ? Math.round((recent30Known / recent30All) * 100) : 0,
    masteredCount: learned.filter((word) => state.progress[word.id]?.status === 'mastered').length,
    checkedIn: Number(today.total) > 0,
  };
}
