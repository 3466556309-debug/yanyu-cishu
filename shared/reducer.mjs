import { addDays, clamp, isDayString, nextSchedule, RATINGS } from './schedule.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);

function isSafeId(value) {
  return typeof value === 'string' && ID_RE.test(value) && !RESERVED_IDS.has(value);
}
const TYPES = new Set(['idiom', 'word']);
const SETTING_KEYS = new Set(['dailyNewLimit', 'reviewMode', 'reviewDailyLimit', 'practiceMode', 'scope']);
const TEXT_LIMIT = 3000;

export function emptyState(nowIso = new Date().toISOString()) {
  return {
    version: 1,
    seedVersion: 0,
    words: {},
    groups: {},
    progress: {},
    mistakes: {},
    checkins: {},
    settings: {
      dailyNewLimit: 20,
      reviewMode: 'clear',
      reviewDailyLimit: 30,
      practiceMode: 'reveal',
      scope: 'all',
      updatedAt: nowIso,
    },
  };
}

export function cloneState(state) {
  return structuredClone(state);
}

function cleanText(value, limit = TEXT_LIMIT) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function cleanStringList(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const item of value) {
    const text = cleanText(item, 40);
    if (text && !seen.has(text) && output.length < limit) {
      seen.add(text);
      output.push(text);
    }
  }
  return output;
}

function validIso(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  return Number.isFinite(Date.parse(value));
}

function wordConflict(state, word) {
  return Object.values(state.words).some((item) => (
    item && !item.deletedAt && item.id !== word.id && item.type === word.type
    && item.term.trim() === word.term
  ));
}

function sanitizeWord(state, payload, opAt) {
  const id = cleanText(payload.id, 80);
  if (!isSafeId(id)) return { error: '词条编号不正确' };
  const type = payload.type;
  if (!TYPES.has(type)) return { error: '词条类型不正确' };
  const term = cleanText(payload.term, 40);
  if (!term) return { error: '词语不能为空' };
  const definition = cleanText(payload.definition);
  if (!definition) return { error: '释义不能为空' };
  const updatedAt = validIso(payload.updatedAt) ? payload.updatedAt : opAt;
  return {
    word: {
      id,
      type,
      term,
      definition,
      example: cleanText(payload.example),
      source: cleanText(payload.source, 300),
      near: cleanStringList(payload.near),
      far: cleanStringList(payload.far),
      createdAt: validIso(payload.createdAt) ? payload.createdAt : updatedAt,
      updatedAt,
      deletedAt: null,
    },
  };
}

function applyWordUpsert(state, payload, opAt) {
  const { word, error } = sanitizeWord(state, payload, opAt);
  if (error) return { applied: false, reason: error };
  const existing = state.words[word.id];
  if (existing && validIso(existing.updatedAt) && Date.parse(existing.updatedAt) > Date.parse(word.updatedAt)) {
    return { applied: false, reason: '已有更新的修改' };
  }
  if (wordConflict(state, word)) {
    return { applied: false, reason: `“${word.term}”已存在，未覆盖` };
  }
  state.words[word.id] = {
    ...(existing || {}),
    ...word,
    createdAt: existing?.createdAt || word.createdAt,
  };
  return { applied: true };
}

function applyWordDelete(state, payload, opAt) {
  const id = cleanText(payload.id, 80);
  if (!isSafeId(id)) return { applied: false, reason: '词条编号不正确' };
  const word = Object.hasOwn(state.words, id) ? state.words[id] : null;
  if (!word || word.deletedAt) return { applied: false, reason: '词条不存在' };
  const at = validIso(payload.updatedAt) ? payload.updatedAt : opAt;
  state.words[id] = { ...word, deletedAt: at, updatedAt: at };
  return { applied: true };
}

function applyGroupUpsert(state, payload, opAt) {
  const id = cleanText(payload.id, 80);
  if (!isSafeId(id)) return { applied: false, reason: '分组编号不正确' };
  const name = cleanText(payload.name, 60);
  if (!name) return { applied: false, reason: '组名不能为空' };
  const wordIds = Array.isArray(payload.wordIds)
    ? [...new Set(payload.wordIds.filter((wid) => isSafeId(wid) && Object.hasOwn(state.words, wid) && state.words[wid] && !state.words[wid].deletedAt))].slice(0, 40)
    : [];
  if (wordIds.length < 2) return { applied: false, reason: '每组至少保留两个词' };
  const updatedAt = validIso(payload.updatedAt) ? payload.updatedAt : opAt;
  const existing = state.groups[id];
  if (existing && validIso(existing.updatedAt) && Date.parse(existing.updatedAt) > Date.parse(updatedAt)) {
    return { applied: false, reason: '已有更新的修改' };
  }
  state.groups[id] = {
    id,
    name,
    note: cleanText(payload.note, 500),
    wordIds,
    createdAt: existing?.createdAt || updatedAt,
    updatedAt,
    deletedAt: null,
  };
  return { applied: true };
}

function applyGroupDelete(state, payload, opAt) {
  const id = cleanText(payload.id, 80);
  if (!isSafeId(id)) return { applied: false, reason: '分组编号不正确' };
  const group = Object.hasOwn(state.groups, id) ? state.groups[id] : null;
  if (!group || group.deletedAt) return { applied: false, reason: '分组不存在' };
  const at = validIso(payload.updatedAt) ? payload.updatedAt : opAt;
  state.groups[id] = { ...group, deletedAt: at, updatedAt: at };
  return { applied: true };
}

function applySettings(state, payload, opAt) {
  const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {};
  const next = { ...state.settings };
  for (const [key, value] of Object.entries(patch)) {
    if (!SETTING_KEYS.has(key)) continue;
    if (key === 'dailyNewLimit') {
      if (Number.isFinite(Number(value))) next[key] = clamp(Math.floor(Number(value)), 0, 100);
    } else if (key === 'reviewDailyLimit') {
      if (Number.isFinite(Number(value))) next[key] = clamp(Math.floor(Number(value)), 5, 200);
    } else if (key === 'reviewMode') {
      if (value === 'clear' || value === 'flexible') next[key] = value;
    } else if (key === 'practiceMode') {
      if (value === 'reveal' || value === 'cloze') next[key] = value;
    } else if (key === 'scope') {
      if (value === 'all' || value === 'idiom' || value === 'word') next[key] = value;
    }
  }
  next.updatedAt = validIso(opAt) ? opAt : new Date().toISOString();
  state.settings = next;
  return { applied: true };
}

function applyReview(state, payload, opAt) {
  const wordId = cleanText(payload.wordId, 80);
  if (!isSafeId(wordId)) return { applied: false, reason: '词条编号不正确' };
  const word = Object.hasOwn(state.words, wordId) ? state.words[wordId] : null;
  if (!word || word.deletedAt) return { applied: false, reason: '词条不存在' };
  const day = isDayString(payload.day) ? payload.day : null;
  if (!day) return { applied: false, reason: '学习日期不正确' };
  const rating = RATINGS.includes(payload.rating) ? payload.rating : null;
  if (!rating) return { applied: false, reason: '评价结果不正确' };
  const previous = state.progress[wordId];
  const wasNew = !previous?.learnedAt;
  const schedule = nextSchedule(previous, rating, day);
  state.progress[wordId] = {
    ...schedule,
    wordId,
    lastMode: payload.mode === 'cloze' ? 'cloze' : 'reveal',
    lastReviewedAt: validIso(opAt) ? opAt : new Date().toISOString(),
    updatedAt: validIso(opAt) ? opAt : new Date().toISOString(),
  };

  const dictationWrong = payload.dictation === 'wrong';
  const synonymWrong = payload.synonym === 'wrong';
  const clozeWrong = payload.cloze === 'wrong';
  const anyWrong = rating === 'forgotten' || dictationWrong || synonymWrong || clozeWrong;
  if (anyWrong) {
    const prior = state.mistakes[wordId] || { wordId, wrongCount: 0, firstWrongAt: opAt };
    state.mistakes[wordId] = {
      wordId,
      wrongCount: (Number(prior.wrongCount) || 0) + 1,
      firstWrongAt: prior.firstWrongAt || opAt,
      lastWrongAt: validIso(opAt) ? opAt : new Date().toISOString(),
      lastWrongKind: clozeWrong ? 'cloze' : synonymWrong ? 'synonym' : dictationWrong ? 'dictation' : 'rating',
      active: true,
      removedAt: null,
      note: prior.note || '',
    };
  }

  const priorCheckin = state.checkins[day] || {
    date: day,
    total: 0,
    newCount: 0,
    reviewCount: 0,
    knownCount: 0,
    fuzzyCount: 0,
    forgottenCount: 0,
    firstAt: opAt,
  };
  state.checkins[day] = {
    ...priorCheckin,
    total: (Number(priorCheckin.total) || 0) + 1,
    newCount: (Number(priorCheckin.newCount) || 0) + (wasNew ? 1 : 0),
    reviewCount: (Number(priorCheckin.reviewCount) || 0) + (wasNew ? 0 : 1),
    knownCount: (Number(priorCheckin.knownCount) || 0) + (rating === 'known' ? 1 : 0),
    fuzzyCount: (Number(priorCheckin.fuzzyCount) || 0) + (rating === 'fuzzy' ? 1 : 0),
    forgottenCount: (Number(priorCheckin.forgottenCount) || 0) + (rating === 'forgotten' ? 1 : 0),
    lastAt: validIso(opAt) ? opAt : new Date().toISOString(),
  };
  return { applied: true };
}

function applyMistakeRemove(state, payload, opAt) {
  const wordId = cleanText(payload.wordId, 80);
  if (!isSafeId(wordId)) return { applied: false, reason: '词条编号不正确' };
  const item = Object.hasOwn(state.mistakes, wordId) ? state.mistakes[wordId] : null;
  if (!item || item.active === false) return { applied: false, reason: '错词已不在本中' };
  const at = validIso(opAt) ? opAt : new Date().toISOString();
  state.mistakes[wordId] = { ...item, active: false, removedAt: at, note: cleanText(payload.note, 300) || item.note || '' };
  return { applied: true };
}

function applyMistakeRestore(state, payload, opAt) {
  const wordId = cleanText(payload.wordId, 80);
  if (!isSafeId(wordId)) return { applied: false, reason: '词条编号不正确' };
  const item = Object.hasOwn(state.mistakes, wordId) ? state.mistakes[wordId] : null;
  if (!item) return { applied: false, reason: '错词不存在' };
  state.mistakes[wordId] = {
    ...item,
    active: true,
    removedAt: null,
    lastWrongAt: validIso(opAt) ? opAt : new Date().toISOString(),
  };
  return { applied: true };
}

function applyOpInPlace(state, op, fallbackAt) {
  const opAt = validIso(op?.at) ? op.at : fallbackAt;
  const payload = op?.payload && typeof op.payload === 'object' ? op.payload : {};
  switch (op?.type) {
    case 'word.upsert':
      return applyWordUpsert(state, payload, opAt);
    case 'word.delete':
      return applyWordDelete(state, payload, opAt);
    case 'group.upsert':
      return applyGroupUpsert(state, payload, opAt);
    case 'group.delete':
      return applyGroupDelete(state, payload, opAt);
    case 'settings.patch':
      return applySettings(state, payload, opAt);
    case 'review.record':
      return applyReview(state, payload, opAt);
    case 'mistake.remove':
      return applyMistakeRemove(state, payload, opAt);
    case 'mistake.restore':
      return applyMistakeRestore(state, payload, opAt);
    default:
      return { applied: false, reason: '不认识的操作' };
  }
}

export function applyOp(state, op) {
  const next = cloneState(state);
  const result = applyOpInPlace(next, op, new Date().toISOString());
  return { state: next, ...result };
}

export function applyOps(state, ops) {
  const next = cloneState(state);
  const skipped = [];
  let applied = 0;
  const fallbackAt = new Date().toISOString();
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
      skipped.push({ index, opId: op?.opId || '', reason: '操作格式不正确' });
      continue;
    }
    const result = applyOpInPlace(next, op, fallbackAt);
    if (result.applied) applied += 1;
    else skipped.push({ index, opId: op.opId || '', reason: result.reason || '未应用' });
  }
  return { state: next, applied, skipped };
}

export function sanitizeImportedWord(input) {
  const type = input.type === '成语' ? 'idiom' : input.type === '实词' ? 'word' : input.type;
  return {
    type,
    term: cleanText(input.term, 40),
    definition: cleanText(input.definition),
    example: cleanText(input.example),
    source: cleanText(input.source, 300),
    near: cleanStringList(input.near),
    far: cleanStringList(input.far),
  };
}
