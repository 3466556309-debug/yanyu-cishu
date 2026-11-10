import { icon } from './icons.js';
import { groupsForWord, activeWords, todayPlan, TYPE_LABELS, isLearned } from '/shared/selectors.mjs';
import { localDay } from '/shared/schedule.mjs';
import { attr, escapeHtml, highlightTerm, shuffle, unique } from './util.js';
import { renderShell, syncLabel } from './views.js';

const KIND_LABELS = {
  daily: '今日学习', review: '到期复习', new: '新学', mistakes: '错词练习',
  single: '单词语练习', group: '易混组对比',
};

function makeQueue(app, words) {
  return words.map((word) => ({ wordId: word.id, isNew: !isLearned(app.state, word.id) }));
}

export function startPlanStudy(app, selection = 'daily') {
  const plan = todayPlan(app.state, localDay());
  let words = [];
  if (selection === 'daily') words = [...plan.due, ...plan.fresh];
  else if (selection === 'review') words = [...plan.due];
  else if (selection === 'new') words = [...plan.fresh];
  if (!words.length) return false;
  app.study = {
    kind: selection === 'daily' ? 'daily' : selection,
    mode: app.state.settings.practiceMode === 'cloze' ? 'cloze' : 'reveal',
    scope: plan.scope,
    queue: makeQueue(app, words),
    index: 0,
    results: [],
    startedAt: new Date().toISOString(),
    groupId: '',
  };
  prepareCurrent(app);
  return true;
}

export function startMistakeStudy(app, wordIds = null) {
  const ids = wordIds || Object.values(app.state.mistakes || {})
    .filter((item) => item.active !== false && app.state.words[item.wordId] && !app.state.words[item.wordId].deletedAt)
    .sort((a, b) => String(b.lastWrongAt).localeCompare(String(a.lastWrongAt)))
    .map((item) => item.wordId);
  const words = ids.map((id) => app.state.words[id]).filter(Boolean);
  if (!words.length) return false;
  app.study = {
    kind: 'mistakes',
    mode: app.state.settings.practiceMode === 'cloze' ? 'cloze' : 'reveal',
    scope: 'all',
    queue: makeQueue(app, words),
    index: 0,
    results: [],
    startedAt: new Date().toISOString(),
    groupId: '',
  };
  prepareCurrent(app);
  return true;
}

export function startSingleStudy(app, wordId) {
  const word = app.state.words[wordId];
  if (!word || word.deletedAt) return false;
  app.study = {
    kind: 'single',
    mode: app.state.settings.practiceMode === 'cloze' ? 'cloze' : 'reveal',
    scope: word.type,
    queue: makeQueue(app, [word]),
    index: 0,
    results: [],
    startedAt: new Date().toISOString(),
    groupId: '',
  };
  prepareCurrent(app);
  return true;
}

export function startGroupStudy(app, groupId) {
  const group = app.state.groups[groupId];
  if (!group || group.deletedAt) return false;
  const words = group.wordIds.map((id) => app.state.words[id]).filter((word) => word && !word.deletedAt);
  if (words.length < 2) return false;
  app.study = {
    kind: 'group',
    mode: 'cloze',
    scope: 'all',
    queue: makeQueue(app, shuffle(words)),
    index: 0,
    results: [],
    startedAt: new Date().toISOString(),
    groupId,
  };
  prepareCurrent(app);
  return true;
}

function groupPool(app, word) {
  const groups = groupsForWord(app.state, word.id);
  const terms = [];
  for (const group of groups) {
    for (const id of group.wordIds) {
      const item = app.state.words[id];
      if (item && !item.deletedAt) terms.push(item.term);
    }
  }
  return unique(terms);
}

function buildSynonym(app, word) {
  const groupTerms = groupPool(app, word);
  let correct = (word.near || []).find((item) => item && item !== word.term);
  if (!correct) correct = groupTerms.find((term) => term !== word.term);
  if (!correct) {
    const fallback = activeWords(app.state).find((item) => item.id !== word.id && item.type === word.type);
    correct = fallback?.term || '';
  }
  if (!correct) return null;
  const pool = unique([
    ...(word.far || []), ...groupTerms,
    ...activeWords(app.state).filter((item) => item.type === word.type).map((item) => item.term),
  ]).filter((term) => term !== correct && term !== word.term);
  const distractors = shuffle(pool).slice(0, 3);
  const options = shuffle([correct, ...distractors]);
  if (options.length < 2) return null;
  return { options, correct, prompt: '下面哪个词与它意思最接近，或最容易和它混淆？' };
}

function buildCloze(app, word, onlyTerms = null) {
  const term = word.term;
  const hasTerm = typeof word.example === 'string' && word.example.includes(term);
  const sentence = hasTerm ? word.example : '';
  let pool = onlyTerms ? unique(onlyTerms) : unique([
    ...groupPool(app, word),
    ...(word.far || []),
    ...activeWords(app.state).filter((item) => item.type === word.type).map((item) => item.term),
  ]);
  pool = pool.filter((item) => item !== term);
  const options = shuffle([term, ...shuffle(pool).slice(0, 3)]);
  return {
    sentence,
    hasTerm,
    options,
    correct: term,
    fallbackDefinition: word.definition,
    source: word.source || '',
  };
}

function prepareCurrent(app) {
  const study = app.study;
  const item = study?.queue?.[study.index];
  if (!item) return null;
  const word = app.state.words[item.wordId];
  if (!word || word.deletedAt) return null;
  item.word = word;
  if (study.mode === 'cloze') {
    const group = study.kind === 'group' ? app.state.groups[study.groupId] : null;
    const onlyTerms = group
      ? group.wordIds.map((id) => app.state.words[id]).filter(Boolean).map((w) => w.term)
      : null;
    const cloze = buildCloze(app, word, onlyTerms);
    study.current = {
      ...item,
      rating: null,
      choice: null,
      answered: false,
      cloze,
    };
  } else {
    study.current = {
      ...item,
      revealed: false,
      rating: null,
      dictationAnswer: '',
      dictationResult: null,
      synonymResult: null,
      synonymChoice: null,
      synonym: buildSynonym(app, word),
    };
  }
  return study.current;
}

export function canAdvance(app) {
  const study = app.study;
  const current = study?.current;
  if (!current) return false;
  if (study.mode === 'cloze') return Boolean(current.answered);
  return Boolean(current.rating && current.dictationResult && (current.synonymResult || !current.synonym));
}

function progressBar(study) {
  const total = Math.max(1, study.queue.length);
  const done = study.index;
  return `<div class="session-progress" aria-hidden="true"><span data-progress style="width:${Math.min(100, Math.round((done / total) * 100))}%"></span></div>`;
}

function topMeta(app, study) {
  const item = study.current;
  const state = syncLabel(app);
  return `<div class="practice-top">
    <button class="practice-exit" data-action="exit-practice">${icon('arrowLeft', 15)}退出本轮</button>
    <div class="practice-meta">
      <span class="kind-badge">${KIND_LABELS[study.kind] || '练习'}</span>
      <span>${study.index + 1} / ${study.queue.length}</span>
      <span class="sync-chip ${state.cls}" data-sync-chip title="学习记录自动保存">${icon(state.icon, 12)}${escapeHtml(state.label || state.text)}</span>
    </div>
  </div>`;
}

export function renderPractice(app) {
  const study = app.study;
  if (!study) {
    return renderShell(app, `<div class="practice-page"><div class="practice-card practice-empty"><div class="empty-mark">歇</div><h1>现在没有正在进行的练习</h1><p>从今日计划、错词本或易混组开始吧。</p><a class="btn primary" href="#/home">回到今日学习</a></div></div>`, { noBottomNav: true });
  }
  if (study.finished) return renderShell(app, renderSummary(app), { noBottomNav: true });
  const current = study.current;
  if (!current) {
    study.finished = true;
    return renderShell(app, renderSummary(app), { noBottomNav: true });
  }
  const content = `<div class="practice-page">
    ${topMeta(app, study)}
    ${progressBar(study)}
    <article class="practice-card" id="practice-card">
      ${study.mode === 'cloze' ? renderCloze(app, study, current) : renderReveal(app, study, current)}
    </article>
  </div>`;
  return renderShell(app, content, { noBottomNav: true });
}

function kindBadge(current) {
  return current.isNew ? '新学' : '复习';
}

function renderReveal(app, study, current) {
  const word = current.word;
  const groups = groupsForWord(app.state, word.id);
  if (!current.revealed) {
    return `<div class="practice-kind"><span class="dot"></span>${kindBadge(current)} · ${TYPE_LABELS[word.type]}</div>
      <div class="prompt-wrap">
        <p class="prompt-hint">先别急着看答案。试着在心里说出它的意思，再想一个能用的句子。</p>
        <div class="prompt-term">${escapeHtml(word.term)}</div>
        <div class="prompt-sub">${groups.length ? escapeHtml(groups[0].name) : '个人词库'}</div>
      </div>
      <div class="reveal-btn-wrap"><button class="btn primary large" data-action="reveal">想好了，揭晓答案</button></div>
      <div class="practice-footer"><span class="hint">不着急，想 10 秒也算认真复习。</span><button class="btn ghost" data-action="exit-practice">今天先到这里</button></div>`;
  }
  const near = current.synonym;
  return `<div class="practice-kind"><span class="dot"></span>${kindBadge(current)} · ${TYPE_LABELS[word.type]} · 揭晓</div>
    <div class="reveal-block">
      <div class="reveal-meaning"><span class="reveal-label">释义</span><div class="reveal-def">${escapeHtml(word.definition)}</div></div>
      ${word.example ? `<div class="example-box">${highlightTerm(word.example, word.term)}${word.source ? `<span class="src">${escapeHtml(word.source)}</span>` : ''}</div>` : ''}
      ${(word.near?.length || groups.length) ? `<div class="confusable-row"><span>易混：</span>${(word.near || []).map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join('')}${groups.map((group) => `<a class="mini-chip" href="#/group/${attr(group.id)}" data-action="close-modal-link">${escapeHtml(group.name)}</a>`).join('')}</div>` : ''}
    </div>
    <div class="checks">
      <section class="check-step">
        <span class="step-num">1</span>
        <div class="step-body"><h3>你记得怎么样？</h3>
          <div class="rating-row" role="group" aria-label="自评">
            ${ratingButton('known', '认识', current.rating)}
            ${ratingButton('fuzzy', '模糊', current.rating)}
            ${ratingButton('forgotten', '忘记', current.rating)}
          </div>
        </div>
      </section>
      <section class="check-step">
        <span class="step-num">2</span>
        <div class="step-body"><h3>默写这个词</h3>
          <div class="dictation-row">
            <label class="sr-only" for="dictation-input">默写答案</label>
            <input class="input" id="dictation-input" autocomplete="off" spellcheck="false" placeholder="把词语写在这里" value="${attr(current.dictationAnswer || '')}" ${current.dictationResult ? 'disabled' : ''}>
            <button class="btn" data-action="check-dictation" ${current.dictationResult ? 'disabled' : ''}>检查</button>
          </div>
          <div class="dictation-feedback ${current.dictationResult === 'correct' ? 'ok' : current.dictationResult === 'wrong' ? 'no' : ''}" id="dictation-feedback" aria-live="polite">${dictationFeedback(current, word)}</div>
        </div>
      </section>
      <section class="check-step">
        <span class="step-num">3</span>
        <div class="step-body"><h3>选近义项</h3>
          ${near ? `<p class="small muted" style="margin:-4px 0 9px">${escapeHtml(near.prompt)}</p>
          <div class="choice-grid" role="group" aria-label="近义项选择">
            ${near.options.map((option, index) => `<button class="choice ${choiceClass(current.synonymResult, current.synonymChoice, option, near.correct)}" data-action="synonym-choice" data-value="${attr(option)}" ${current.synonymResult ? 'disabled' : ''}><span class="choice-letter">${'ABCD'[index]}</span>${escapeHtml(option)}</button>`).join('')}
          </div>
          <div id="synonym-feedback">${current.synonymResult ? `<div class="dictation-feedback ${current.synonymResult === 'correct' ? 'ok' : 'no'}">${current.synonymResult === 'correct' ? '选对了。' : `正确答案是 <b>${escapeHtml(near.correct)}</b>。`}</div>` : ''}</div>`
          : `<p class="small muted">这个词还没有填写近义项，先完成自评和默写即可。</p>`}
        </div>
      </section>
    </div>
    <div class="practice-footer">
      <span class="hint" id="practice-hint">${canAdvance(app) ? '三项都完成了。' : '三项都完成后，就可以继续。'}</span>
      <button class="btn primary" id="practice-next" data-action="next-card" ${canAdvance(app) ? '' : 'disabled'}>${study.index + 1 >= study.queue.length ? '完成本轮' : '完成，下一个'}${icon('arrowRight', 15)}</button>
    </div>`;
}

function ratingButton(value, label, current) {
  return `<button class="rating-btn ${current === value ? 'selected' : ''}" data-action="rate" data-rating="${value}" aria-pressed="${current === value}"><span class="rating-mark"></span>${label}</button>`;
}

function dictationFeedback(current, word) {
  if (!current.dictationResult) return '';
  if (current.dictationResult === 'correct') return '写对了。';
  if (current.dictationResult === 'skipped') return `这个词暂时没有设置近义项，本轮先跳过。`;
  return `这次没写对。正确写法是 <b>${escapeHtml(word.term)}</b>。`;
}

function choiceClass(result, choice, option, correct) {
  if (!result) return '';
  if (option === correct) return 'correct';
  if (option === choice) return 'wrong';
  return '';
}

function renderCloze(app, study, current) {
  const word = current.word;
  const cloze = current.cloze;
  const isGroup = study.kind === 'group';
  const group = isGroup ? app.state.groups[study.groupId] : null;
  const sentence = cloze.hasTerm
    ? cloze.sentence.replace(word.term, '＿＿＿')
    : '';
  const showAnswered = current.answered;
  return `<div class="practice-kind"><span class="dot"></span>${isGroup ? '易混组对比' : kindBadge(current)} · ${TYPE_LABELS[word.type]}</div>
    ${isGroup ? `<div style="text-align:center;margin-top:12px"><span class="pill">${escapeHtml(group?.name || '')} · 第 ${study.index + 1} / ${study.queue.length} 题</span></div>` : ''}
    <div class="prompt-wrap" style="text-align:left;padding-top:26px">
      <div class="cloze-question-title">${sentence ? '读下面的句子，选择最恰当的词填入空白处。' : '这道题暂时没有含这个词的例句，请根据释义选择最合适的词。'}</div>
      ${sentence ? `<p class="cloze-sentence">${escapeHtml(sentence)}</p>` : `<p class="cloze-sentence" style="font-family:var(--sans);font-size:15px;line-height:1.9">${escapeHtml(cloze.fallbackDefinition)}</p>`}
      ${sentence && cloze.source ? `<div class="cloze-source">${escapeHtml(cloze.source)}</div>` : ''}
    </div>
    <div style="border-top:1px dashed var(--line);padding-top:18px">
      <div class="cloze-question-title">选择一项：</div>
      <div class="choice-grid" role="group" aria-label="选词">
        ${cloze.options.map((option, index) => `<button class="choice ${showAnswered ? (option === cloze.correct ? 'correct' : option === current.choice ? 'wrong' : '') : ''}" data-action="cloze-choice" data-value="${attr(option)}" ${showAnswered ? 'disabled' : ''}><span class="choice-letter">${'ABCD'[index]}</span>${escapeHtml(option)}</button>`).join('')}
      </div>
      ${showAnswered ? `<div class="cloze-feedback ${current.choice === cloze.correct ? 'ok' : 'no'}">
        <h3>${current.choice === cloze.correct ? '选对了。' : `正确答案是「${escapeHtml(cloze.correct)}」`}</h3>
        <p>${escapeHtml(word.definition)}</p>
        ${word.example ? `<div class="example-box">${highlightTerm(word.example, word.term)}${word.source ? `<span class="src">${escapeHtml(word.source)}</span>` : ''}</div>` : ''}
      </div>` : ''}
    </div>
    <div class="practice-footer">
      <span class="hint" id="practice-hint">${showAnswered ? '已经记下这次结果。' : '选一个最合适的词。'}</span>
      <button class="btn primary" id="practice-next" data-action="next-card" ${showAnswered ? '' : 'disabled'}>${study.index + 1 >= study.queue.length ? '完成本轮' : '下一个'}${icon('arrowRight', 15)}</button>
    </div>`;
}

export function completeCurrent(app) {
  const study = app.study;
  if (!study || !canAdvance(app)) return false;
  const current = study.current;
  const word = current.word;
  let rating = current.rating;
  let dictation = current.dictationResult;
  let synonym = current.synonymResult;
  let cloze = null;
  if (study.mode === 'cloze') {
    const correct = current.choice === current.cloze.correct;
    rating = correct ? 'known' : 'forgotten';
    cloze = correct ? 'correct' : 'wrong';
    dictation = null;
    synonym = null;
  }
  app.recordReview({
    wordId: word.id,
    rating,
    mode: study.mode,
    dictation,
    synonym,
    cloze,
    day: localDay(),
  });
  const wrong = rating === 'forgotten' || dictation === 'wrong' || synonym === 'wrong' || cloze === 'wrong';
  study.results.push({
    wordId: word.id, term: word.term, type: word.type, rating, isNew: current.isNew, wrong,
  });
  study.index += 1;
  if (study.index >= study.queue.length) {
    study.finished = true;
    study.current = null;
    return true;
  }
  prepareCurrent(app);
  return true;
}

export function renderSummary(app) {
  const study = app.study;
  const results = study?.results || [];
  const correct = results.filter((item) => !item.wrong).length;
  const newCount = results.filter((item) => item.isNew).length;
  const today = app.state.checkins?.[localDay()];
  const plan = todayPlan(app.state, localDay());
  const group = study?.groupId ? app.state.groups[study.groupId] : null;
  const rate = results.length ? Math.round((correct / results.length) * 100) : 0;
  return `<div class="practice-page">
    <div class="practice-card">
      <div class="session-summary">
        <div class="summary-seal">${rate >= 80 ? '稳' : rate >= 50 ? '进' : '记'}</div>
        <h1>${results.length ? '这一轮完成了。' : '这一轮先到这里。'}</h1>
        <p class="lead">${results.length ? (today ? `今天已经累计学习 ${today.total} 次，打卡完成。` : '学习记录已经记下。') : '没有完成的词，下次再见。'}</p>
        <div class="summary-grid">
          <div class="summary-stat"><strong>${results.length}</strong><span>完成词数</span></div>
          <div class="summary-stat"><strong>${rate}%</strong><span>这次顺利</span></div>
          <div class="summary-stat"><strong>${newCount}</strong><span>其中新学</span></div>
        </div>
        ${results.length ? `<div class="card" style="text-align:left;padding:14px 17px;margin-bottom:20px"><div class="small muted" style="margin-bottom:7px">这一轮遇见的词</div><div class="group-chips">${results.map((item) => `<span class="mini-chip">${escapeHtml(item.term)}${item.wrong ? ' · 待回看' : ''}</span>`).join('')}</div></div>` : ''}
        ${plan.dueRemaining.length ? `<div class="due-note" style="text-align:left">${icon('clock', 16)}<span>今天还有 <strong>${plan.dueRemaining.length}</strong> 个到期词，按你选的“可以留到后面”暂时留着。</span></div>` : ''}
        ${!plan.dueCount && plan.fresh.length === 0 ? `<div class="due-note" style="text-align:left">${icon('check', 16)}<span>今天的新学和到期复习都清空了。</span></div>` : ''}
        <div class="summary-actions">
          <a class="btn primary" href="#/home">回到今日学习</a>
          ${group ? `<a class="btn" href="#/group/${attr(group.id)}">再看对比表</a>` : ''}
          ${study?.kind === 'mistakes' ? `<button class="btn" data-action="restart-mistakes">再练一遍错词</button>` : ''}
          <a class="btn ghost" href="#/stats">看学习统计</a>
        </div>
      </div>
    </div>
  </div>`;
}

export function advanceAndRender(app) {
  // index/current 已经准备好；由 app 统一触发整页重绘。
  return renderPractice(app);
}
