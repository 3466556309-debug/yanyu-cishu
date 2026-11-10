import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../shared/seed.mjs';
import { applyOp, applyOps } from '../shared/reducer.mjs';
import { todayPlan, streakInfo, mistakeEntries, dueWords, stats } from '../shared/selectors.mjs';
import { addDays } from '../shared/schedule.mjs';

const DAY = '2026-11-10';

function review(state, wordId, rating, extra = {}) {
  return applyOp(state, {
    opId: `op-${Math.random().toString(36).slice(2, 10)}`,
    at: `${DAY}T08:00:00.000Z`,
    type: 'review.record',
    payload: { wordId, rating, day: DAY, mode: 'reveal', ...extra },
  });
}

test('初始词库含 60 个词、4 个十词易混组，成语和实词都有', () => {
  const state = createSeedState();
  const words = Object.values(state.words);
  assert.equal(words.length, 60);
  assert.equal(words.filter((word) => word.type === 'idiom').length, 32);
  assert.equal(words.filter((word) => word.type === 'word').length, 28);
  assert.equal(Object.keys(state.groups).length, 4);
  for (const group of Object.values(state.groups)) assert.equal(group.wordIds.length, 10);
});

test('认识、模糊、忘记采用不同间隔并写回今日打卡', () => {
  let state = createSeedState();
  const known = review(state, 'seed-idiom-01', 'known');
  assert.equal(known.state.progress['seed-idiom-01'].dueDate, addDays(DAY, 3));
  assert.equal(known.state.checkins[DAY].newCount, 1);
  assert.equal(known.state.checkins[DAY].total, 1);

  state = review(state, 'seed-idiom-02', 'fuzzy').state;
  assert.equal(state.progress['seed-idiom-02'].dueDate, addDays(DAY, 1));
  state = review(state, 'seed-idiom-03', 'forgotten').state;
  assert.equal(state.progress['seed-idiom-03'].dueDate, addDays(DAY, 1));
  assert.equal(mistakeEntries(state).length, 1);
  assert.equal(streakInfo(state, DAY).current, 1);
});

test('默写或近义项错了会进错词本，即使自评认识', () => {
  let state = createSeedState();
  state = review(state, 'seed-idiom-01', 'known', { dictation: 'wrong', synonym: 'correct' }).state;
  assert.equal(mistakeEntries(state).length, 1);
  assert.equal(mistakeEntries(state)[0].word.term, '一蹴而就');
});

test('当天清完与可留到后面两种复习上限', () => {
  let state = createSeedState();
  // 把 12 个词做成很早到期
  let index = 0;
  for (const id of Object.keys(state.words).slice(0, 12)) {
    state = review(state, id, 'known').state;
    state.progress[id].dueDate = addDays(DAY, -5);
    index += 1;
  }
  state.settings.reviewMode = 'clear';
  const clearPlan = todayPlan(state, DAY, 'all');
  assert.equal(clearPlan.due.length, 12);
  assert.equal(clearPlan.dueRemaining.length, 0);

  state.settings.reviewMode = 'flexible';
  state.settings.reviewDailyLimit = 5;
  const flexible = todayPlan(state, DAY, 'all');
  assert.equal(flexible.due.length, 5);
  assert.equal(flexible.dueRemaining.length, 7);
});

test('每日新学上限生效，已学新词计入当天额度', () => {
  let state = createSeedState();
  state.settings.dailyNewLimit = 20;
  const plan1 = todayPlan(state, DAY, 'all');
  assert.equal(plan1.fresh.length, 20);
  for (const word of plan1.fresh) state = review(state, word.id, 'known').state;
  const plan2 = todayPlan(state, DAY, 'all');
  assert.equal(plan2.fresh.length, 0);
  assert.equal(stats(state, DAY).today.newCount, 20);
});

test('导入时同类型同字面才冲突，其他词仍可写入', () => {
  let state = createSeedState();
  const ops = [
    {
      opId: 'import-1', at: `${DAY}T08:00:00.000Z`, type: 'word.upsert',
      payload: { id: 'custom-1', type: 'word', term: '截至', definition: '重复词', updatedAt: `${DAY}T08:00:00.000Z` },
    },
    {
      opId: 'import-2', at: `${DAY}T08:00:00.000Z`, type: 'word.upsert',
      payload: { id: 'custom-2', type: 'word', term: '甄别', definition: '仔细辨别。', updatedAt: `${DAY}T08:00:00.000Z` },
    },
    {
      opId: 'import-3', at: `${DAY}T08:00:00.000Z`, type: 'word.upsert',
      payload: { id: 'custom-3', type: 'idiom', term: '按部就班', definition: '按照一定步骤进行。', updatedAt: `${DAY}T08:00:00.000Z` },
    },
  ];
  const result = applyOps(state, ops);
  assert.equal(result.applied, 2);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /已存在/);
  assert.equal(result.state.words['custom-2'].term, '甄别');
  assert.equal(result.state.words['custom-3'].type, 'idiom');
});

test('到期词与复习模式联动', () => {
  let state = createSeedState();
  for (const id of Object.keys(state.words).slice(0, 10)) {
    state = review(state, id, 'known').state;
    state.progress[id].dueDate = DAY;
  }
  assert.equal(dueWords(state, DAY, 'all').length, 10);
  assert.equal(dueWords(state, DAY, 'idiom').every((word) => word.type === 'idiom'), true);
});
