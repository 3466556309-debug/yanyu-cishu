import { icon } from './icons.js';
import * as api from './api.js';
import * as localDb from './db.js';
import { IS_LOCAL_ONLY } from './mode.js';
import { parseImport, parseImportSource, finalizeRecords, buildImportOps } from './importer.js';
import { readImportFile, ImportFileError } from './import-files.js';
import {
  renderAuth, renderRoute, renderWordList, renderWordModal, renderWordDetail,
  renderGroupModal, renderImportModal, renderPasswordModal, renderConfirmModal,
  syncLabel,
} from './views.js';
import {
  canAdvance, completeCurrent, renderPractice, startGroupStudy,
  startMistakeStudy, startPlanStudy, startSingleStudy,
} from './practice.js';
import { applyOp, applyOps } from '../shared/reducer.mjs';
import { localDay } from '../shared/schedule.mjs';
import { activeWords } from '../shared/selectors.mjs';
import { createSeedState } from '../shared/seed.mjs';
import { attr, escapeHtml, parseRoute, uid } from './util.js';

const SESSION_KEY = 'yanyu.session';
const LAST_USER_KEY = 'yanyu.lastUser';
const LOCAL_USER = Object.freeze({ id: 'local-user', username: '本机词库', createdAt: '' });

const app = {
  localOnly: IS_LOCAL_ONLY,
  session: null,
  authenticated: false,
  state: null,
  revision: 0,
  pendingOps: [],
  route: parseRoute(),
  online: navigator.onLine !== false,
  reachable: true,
  syncing: false,
  sync: { lastSuccessAt: 0, lastError: '', failures: 0 },
  storageAvailable: true,
  study: null,
  ui: {
    authTab: 'login',
    authUsername: '',
    wordSearch: '',
    wordType: 'all',
    mistakeSearch: '',
  },
  authError: '',
  authNotice: '',
  modalNeedsRender: false,
  confirmHandler: null,
  booted: false,
  importDraft: null,
  importBusy: false,
};

let syncRunner = null;
let syncTimer = 0;
let saveChain = Promise.resolve();
let storageWarned = false;
let mistakeSearchTimer = 0;

/* ==================== 启动 ==================== */

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user?.id || !parsed?.user?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    showToast('浏览器没有允许保存登录状态，下次打开可能需要重新登录。', 'warn');
  }
  try {
    if (session?.user?.username) localStorage.setItem(LAST_USER_KEY, session.user.username);
  } catch { /* 不影响使用 */ }
}

async function init() {
  bindEvents();
  app.route = parseRoute();
  if (!location.hash) history.replaceState(null, '', '#/home');
  if (app.route.name === 'practice') {
    history.replaceState(null, '', '#/home');
    app.route = { name: 'home', id: '', tail: '' };
  }

  if (app.localOnly) {
    await initLocalOnly();
  } else {
    const session = loadSession();
    if (session) {
      app.session = session;
      app.authenticated = true;
      app.ui.authUsername = session.user.username;
      try {
        const local = await localDb.loadLocal(session.user.id);
        app.pendingOps = local.ops || [];
        if (local.snapshot?.state) {
          app.state = local.snapshot.state;
          app.revision = Number(local.snapshot.revision) || 0;
          app.booted = true;
          render();
          syncNow();
        } else if (navigator.onLine) {
          renderBoot('正在取回你的词库…');
          const ok = await syncNow();
          if (!ok && !app.state) {
            app.authenticated = false;
            app.authNotice = '这台设备还没有保存过你的词库。请先联网登录一次，之后就能离线使用。';
            render();
          }
        } else {
          app.authenticated = false;
          app.authNotice = '这台设备还没有保存过这个词库。第一次使用需要联网；已经登录并使用过之后，断网也能继续学。';
          render();
        }
      } catch (error) {
        console.error(error);
        app.authenticated = false;
        app.authNotice = '这台设备上保存的内容读不出来。请刷新页面再试，或联网后重新登录。';
        render();
      }
    } else {
      app.ui.authUsername = (() => {
        try { return localStorage.getItem(LAST_USER_KEY) || ''; } catch { return ''; }
      })();
      render();
    }
    setInterval(() => {
      if (app.session && app.state && navigator.onLine && document.visibilityState === 'visible') syncNow();
    }, 45000);
  }

  registerServiceWorker();
}

/**
 * GitHub Pages 静态版：不登录、不请求接口，词库固定保存在这个浏览器的 IndexedDB。
 * 第一次打开时复制一份初始高频词，之后只改这一份。
 */
async function initLocalOnly() {
  app.localOnly = true;
  app.session = {
    token: '',
    user: { ...LOCAL_USER, createdAt: new Date().toISOString().slice(0, 10) },
    savedAt: new Date().toISOString(),
  };
  app.authenticated = true;
  app.ui.authUsername = LOCAL_USER.username;
  renderBoot('正在打开这台设备上的词库…');

  let local = { snapshot: null, ops: [] };
  try {
    local = await localDb.loadLocal(LOCAL_USER.id);
  } catch (error) {
    console.error('[local-store]', error);
    app.storageAvailable = false;
  }

  if (local.snapshot?.state?.words) {
    app.state = local.snapshot.state;
    app.revision = Number(local.snapshot.revision) || 1;
    app.sync.lastSuccessAt = Date.parse(local.snapshot.cachedAt || '') || Date.now();
  } else {
    app.state = createSeedState();
    app.revision = 1;
    app.sync.lastSuccessAt = Date.now();
    persistLocal();
  }

  app.pendingOps = [];
  app.booted = true;
  render();
  if (!app.storageAvailable) {
    toast('这个浏览器没有允许本机存储。现在可以继续用，但刷新后进度可能留不住。', 'warn');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // 相对路径才能同时适配根域名和 GitHub Pages 的 /yanyu-cishu/ 前缀。
  const workerUrl = new URL('../sw.js', import.meta.url);
  navigator.serviceWorker.register(workerUrl).catch(() => {});
}

/* ==================== 渲染 ==================== */

function render(options = {}) {
  const root = document.getElementById('app');
  if (!root) return;
  const scrollY = window.scrollY;
  const active = document.activeElement;
  const activeId = active?.id || '';
  const activeStart = active && 'selectionStart' in active ? active.selectionStart : null;
  const activeEnd = active && 'selectionEnd' in active ? active.selectionEnd : null;

  if (!app.session || !app.authenticated || !app.state) {
    root.innerHTML = renderAuth(app);
    document.title = '登录 · 言语词库';
    if (options.scrollTop) window.scrollTo(0, 0);
    return;
  }
  if (app.route.name === 'practice') {
    if (!app.study) {
      history.replaceState(null, '', '#/home');
      app.route = { name: 'home', id: '', tail: '' };
    } else {
      root.innerHTML = renderPractice(app);
      document.title = '学习中 · 言语词库';
      if (options.scrollTop) requestAnimationFrame(() => window.scrollTo(0, 0));
      else requestAnimationFrame(() => window.scrollTo(0, scrollY));
      return;
    }
  }
  root.innerHTML = renderRoute(app);
  const titleMap = { home: '今日学习', words: '我的词库', groups: '易混对比', group: '组内辨析', mistakes: '错词本', stats: '学习统计', settings: '设置' };
  document.title = `${titleMap[app.route.name] || '言语词库'} · 言语词库`;
  if (options.scrollTop) requestAnimationFrame(() => window.scrollTo(0, 0));
  else requestAnimationFrame(() => window.scrollTo(0, scrollY));
  if (activeId) {
    const next = document.getElementById(activeId);
    if (next) {
      next.focus({ preventScroll: true });
      if (activeStart !== null && 'setSelectionRange' in next) {
        try { next.setSelectionRange(activeStart, activeEnd); } catch { /* 非文本输入 */ }
      }
    }
  }
}

function renderBoot(message) {
  const root = document.getElementById('app');
  if (root) root.innerHTML = `<div class="boot-screen"><div class="boot-mark" aria-hidden="true">言</div><p>${escapeHtml(message)}</p></div>`;
}

function updateSyncBadges() {
  const state = syncLabel(app);
  document.querySelectorAll('[data-sync-chip]').forEach((el) => {
    el.className = `sync-chip ${state.cls}`;
    el.innerHTML = `${icon(state.icon, 12)}${escapeHtml(state.text)}`;
  });
}

/* ==================== 本地保存与同步 ==================== */

function persistLocal() {
  if (!app.session?.user?.id || !app.state) return;
  const userId = app.session.user.id;
  const snapshot = {
    state: app.state,
    revision: app.revision,
    cachedAt: new Date().toISOString(),
  };
  const ops = app.localOnly ? [] : [...app.pendingOps];
  if (app.localOnly) app.sync.lastSuccessAt = Date.now();
  saveChain = saveChain
    .then(() => localDb.saveLocal(userId, snapshot, ops))
    .then(() => { app.storageAvailable = true; })
    .catch((error) => {
      console.error(error);
      app.storageAvailable = false;
      if (!storageWarned) {
        storageWarned = true;
        showToast(
          app.localOnly
            ? '这个浏览器没有保存成功。刷新后进度可能留不住，请换个普通浏览窗口再试。'
            : '这台设备没有保存离线内容。请保持联网使用，或换一个普通浏览窗口。',
          'warn',
        );
      }
    });
}

function scheduleSync(delay = 700) {
  if (app.localOnly) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (app.online && app.session) syncNow(); }, delay);
}

async function syncNow(options = {}) {
  if (app.localOnly) {
    if (options.manual) showToast('已经保存在这台浏览器里。');
    return true;
  }
  if (!app.session?.token) return false;
  if (!navigator.onLine) {
    app.online = false;
    app.reachable = false;
    updateSyncBadges();
    if (options.manual) showToast('现在没有网络。记录已经先放在这台设备，联网后会自动保存。', 'warn');
    return false;
  }
  if (syncRunner) {
    if (options.manual) showToast('正在保存，请稍等…');
    return syncRunner;
  }
  syncRunner = (async () => {
    app.syncing = true;
    updateSyncBadges();
    let changed = false;
    let rounds = 0;
    try {
      do {
        rounds += 1;
        const batch = app.pendingOps.slice(0, 400);
        const base = app.revision;
        const response = await api.sync(app.session.token, base, batch);
        app.reachable = true;
        app.online = true;
        app.sync.lastError = '';
        if (response.notModified) {
          if (!app.state && !app.revision) {
            // 理论上不会发生：新账号至少有一个版本号。
            continue;
          }
          break;
        }
        if (response.state) {
          const sent = new Set(batch.map((op) => op.opId));
          app.pendingOps = app.pendingOps.filter((op) => !sent.has(op.opId));
          let nextState = response.state;
          for (const op of app.pendingOps) {
            const result = applyOp(nextState, op);
            if (result.applied) nextState = result.state;
          }
          app.state = nextState;
          app.revision = Number(response.revision) || app.revision;
          app.authenticated = true;
          changed = true;
        }
        if (Array.isArray(response.skipped) && response.skipped.length) {
          const reasons = [...new Set(response.skipped.map((item) => item.reason).filter(Boolean))].slice(0, 3);
          showToast(`有 ${response.skipped.length} 条记录没有保存：${reasons.join('；')}`, 'warn');
        }
        app.sync.lastSuccessAt = Date.now();
        persistLocal();
        if (!batch.length && !app.pendingOps.length) break;
        if (!app.pendingOps.length) break;
      } while (rounds < 20);
      app.sync.lastSuccessAt = Date.now();
      app.sync.lastError = '';
      changed = changed || !app.booted;
      app.booted = true;
      updateSyncBadges();
      app.sync.failures = 0;
      if (changed && app.authenticated && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        render({ keepScroll: true });
      }
      if (options.manual) showToast('已经保存好了。');
      return true;
    } catch (error) {
      console.error('[sync]', error);
      if (error.status === 401) {
        handleAuthExpired(error.message);
        return false;
      }
      if (error.code === 'NETWORK' || error.code === 'TIMEOUT') {
        app.reachable = false;
        app.online = navigator.onLine !== false;
      }
      app.sync.failures = Math.min(6, (app.sync.failures || 0) + 1);
      app.sync.lastError = error.message || '暂时没有保存成功';
      updateSyncBadges();
      if (options.manual) showToast(app.sync.lastError, 'warn');
      return false;
    } finally {
      app.syncing = false;
      syncRunner = null;
      updateSyncBadges();
      if (app.pendingOps.length && navigator.onLine && app.authenticated) {
        const delay = Math.min(60000, 1500 * (2 ** Math.min(5, app.sync.failures || 0)));
        scheduleSync(delay);
      }
    }
  })();
  return syncRunner;
}

function handleAuthExpired(message = '') {
  app.authenticated = false;
  app.authNotice = `${message || '登录状态过期了'}。这台设备还有 ${app.pendingOps.length} 条记录，重新登录同一账号后会继续保存。`;
  app.study = null;
  closeModal({ skipRender: true });
  render();
}

/* ==================== 操作与数据修改 ==================== */

function dispatch(op, options = {}) {
  if (!app.state) return false;
  const result = applyOp(app.state, op);
  if (!result.applied) {
    if (options.toast !== false) toast(result.reason || '没有保存这条修改', 'warn');
    return false;
  }
  app.state = result.state;
  if (!app.localOnly) app.pendingOps.push(op);
  persistLocal();
  scheduleSync();
  if (options.render !== false) render({ keepScroll: true });
  return true;
}

function dispatchMany(ops, options = {}) {
  if (!app.state || !ops.length) return { applied: 0, skipped: [] };
  const result = applyOps(app.state, ops);
  const skippedIndexes = new Set(result.skipped.map((item) => item.index));
  const accepted = ops.filter((_, index) => !skippedIndexes.has(index));
  app.state = result.state;
  if (!app.localOnly) app.pendingOps.push(...accepted);
  persistLocal();
  scheduleSync();
  if (options.render !== false) render({ keepScroll: true });
  return { applied: accepted.length, skipped: result.skipped };
}

function patchSettings(patch) {
  dispatch({
    opId: uid('settings'), at: new Date().toISOString(), type: 'settings.patch', payload: { patch },
  }, { render: false });
}

function recordReview(payload) {
  dispatch({
    opId: uid('review'), at: new Date().toISOString(), type: 'review.record', payload,
  }, { render: false, toast: false });
}
app.recordReview = recordReview;

/* ==================== 页面动作 ==================== */

function routeTo(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#/${path}`;
  if (location.hash === target) {
    handleRoute();
    return;
  }
  if (replace) {
    history.replaceState(null, '', target);
    handleRoute();
  } else {
    location.hash = target;
  }
}

function handleRoute() {
  const next = parseRoute();
  if (app.route.name === 'practice' && next.name !== 'practice' && app.study && !app.study.finished && app.study.results.length) {
    const leave = window.confirm('这一轮还没完成。已经学过的词会保留，确定现在退出吗？');
    if (!leave) {
      history.replaceState(null, '', '#/practice');
      return;
    }
  }
  if (next.name === 'practice' && !app.study) {
    history.replaceState(null, '', '#/home');
    app.route = { name: 'home', id: '', tail: '' };
    render({ scrollTop: true });
    return;
  }
  if (next.name !== 'practice') app.study = null;
  app.route = next;
  closeModal({ skipRender: true });
  render({ scrollTop: true });
}

function startStudy(selection) {
  if (app.study && !app.study.finished) {
    showToast('先把手上的这一轮学完，或退出后再开始新的。', 'warn');
    return;
  }
  const ok = startPlanStudy(app, selection);
  if (!ok) {
    showToast(selection === 'review' ? '今天没有到期复习。' : selection === 'new' ? '今天的新学已经到上限了。' : '今天没有需要学习的词。', 'warn');
    return;
  }
  routeTo('practice');
}

function startGroup(groupId) {
  if (!startGroupStudy(app, groupId)) {
    showToast('这一组还不够练习，至少要有两个词。', 'warn');
    return;
  }
  routeTo('practice');
}

function startMistakes(wordIds = null) {
  if (!startMistakeStudy(app, wordIds)) {
    showToast('错词本里暂时没有可练的词。', 'warn');
    return;
  }
  routeTo('practice');
}

function startSingle(wordId) {
  if (!startSingleStudy(app, wordId)) {
    showToast('这个词语已经不在词库里了。', 'warn');
    return;
  }
  closeModal({ skipRender: true });
  routeTo('practice');
}

function handleReveal() {
  const current = app.study?.current;
  if (!current || current.revealed) return;
  current.revealed = true;
  render({ keepScroll: true });
  setTimeout(() => document.querySelector('.rating-btn')?.focus({ preventScroll: true }), 20);
}

function handleRate(value) {
  const current = app.study?.current;
  if (!current || current.revealed === false) return;
  current.rating = value;
  document.querySelectorAll('[data-action="rate"]').forEach((button) => {
    const selected = button.dataset.rating === value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  refreshPracticeFooter();
}

function normalizeAnswer(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[，。！？、；：,.!?;:'"“”‘’]/g, '');
}

function handleDictation() {
  const study = app.study;
  const current = study?.current;
  if (!current || current.dictationResult) return;
  const input = document.getElementById('dictation-input');
  const value = input ? input.value : current.dictationAnswer;
  current.dictationAnswer = value;
  const correct = normalizeAnswer(value) === normalizeAnswer(current.word.term);
  current.dictationResult = correct ? 'correct' : 'wrong';
  if (input) {
    input.disabled = true;
    input.value = value;
  }
  const button = document.querySelector('[data-action="check-dictation"]');
  if (button) button.disabled = true;
  const feedback = document.getElementById('dictation-feedback');
  if (feedback) {
    feedback.className = `dictation-feedback ${correct ? 'ok' : 'no'}`;
    feedback.innerHTML = correct ? '写对了。' : `这次没写对。正确写法是 <b>${escapeHtml(current.word.term)}</b>。`;
  }
  refreshPracticeFooter();
}

function handleSynonym(value) {
  const current = app.study?.current;
  if (!current || !current.synonym || current.synonymResult) return;
  current.synonymChoice = value;
  current.synonymResult = value === current.synonym.correct ? 'correct' : 'wrong';
  document.querySelectorAll('[data-action="synonym-choice"]').forEach((button) => {
    const option = button.dataset.value;
    button.disabled = true;
    if (option === current.synonym.correct) button.classList.add('correct');
    else if (option === value) button.classList.add('wrong');
  });
  const feedback = document.getElementById('synonym-feedback');
  if (feedback) {
    feedback.innerHTML = current.synonymResult === 'correct'
      ? '<div class="dictation-feedback ok">选对了。</div>'
      : `<div class="dictation-feedback no">正确答案是 <b>${escapeHtml(current.synonym.correct)}</b>。</div>`;
  }
  refreshPracticeFooter();
}

function handleCloze(value) {
  const study = app.study;
  const current = study?.current;
  if (!current || current.answered) return;
  current.choice = value;
  current.answered = true;
  render({ keepScroll: true });
  setTimeout(() => document.getElementById('practice-next')?.focus({ preventScroll: true }), 20);
}

function refreshPracticeFooter() {
  const button = document.getElementById('practice-next');
  const hint = document.getElementById('practice-hint');
  if (!button) return;
  const ok = canAdvance(app);
  button.disabled = !ok;
  const last = app.study && app.study.index + 1 >= app.study.queue.length;
  button.innerHTML = `${last ? '完成本轮' : (app.study?.mode === 'cloze' ? '下一个' : '完成，下一个')}${icon('arrowRight', 15)}`;
  if (hint) hint.textContent = ok ? '都完成了，可以继续。' : '三项都完成后，就可以继续。';
}

function handleNext() {
  if (!canAdvance(app)) return;
  completeCurrent(app);
  render({ scrollTop: true });
  setTimeout(() => {
    const target = document.querySelector('.practice-kind, .session-summary h1');
    target?.focus?.({ preventScroll: true });
  }, 20);
}

function exitPractice() {
  const study = app.study;
  if (!study) { routeTo('home'); return; }
  const back = study.kind === 'group' ? `group/${study.groupId}` : 'home';
  const go = () => {
    app.study = null;
    routeTo(back);
  };
  if (study.results.length && !study.finished) {
    askConfirm({
      title: '这一轮还没完成',
      message: `已经学过的 ${study.results.length} 个词会保留。剩下的下次还可以继续。确定现在退出吗？`,
      confirmLabel: '退出本轮',
      onConfirm: go,
    });
  } else {
    go();
  }
}

/* ==================== 弹窗与提示 ==================== */

function openModal(html, options = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = html;
  document.body.classList.add('modal-open');
  app.modalNeedsRender = false;
  setTimeout(() => {
    const focus = root.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button');
    focus?.focus({ preventScroll: true });
  }, 30);
  if (options.wide) root.querySelector('.modal')?.classList.add('wide');
}

function closeModal({ skipRender = false } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  app.confirmHandler = null;
  if (app.modalNeedsRender && !skipRender) {
    app.modalNeedsRender = false;
    render({ keepScroll: true });
  }
}

function askConfirm({ title, message, confirmLabel = '确定', cancelLabel = '再想想', danger = false, onConfirm }) {
  app.confirmHandler = onConfirm;
  openModal(renderConfirmModal({ title, message, confirmLabel, cancelLabel, danger }));
}

function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  root.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => node.remove(), 230);
  }, 3600);
}

function showFormError(id, message) {
  const el = document.getElementById(id);
  if (!el) { toast(message, 'warn'); return; }
  el.textContent = message;
  el.classList.add('show');
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearFormError(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}

/* ==================== 登录注册 ==================== */

async function handleAuthSubmit(form) {
  const submit = document.getElementById('auth-submit');
  const errorBox = document.getElementById('auth-form-error');
  if (errorBox) { errorBox.textContent = ''; errorBox.classList.remove('show'); }
  const username = String(form.username.value || '').trim();
  const password = String(form.password.value || '');
  const register = app.ui.authTab === 'register';
  app.ui.authUsername = username;
  if (username.length < 2) return showFormError('auth-form-error', '用户名至少 2 个字。');
  if (password.length < 6) return showFormError('auth-form-error', '密码至少 6 位。');
  if (register) {
    const second = String(form.password2.value || '');
    if (password !== second) return showFormError('auth-form-error', '两次输入的密码不一样，请再对一下。');
  }
  if (submit) { submit.disabled = true; submit.textContent = register ? '正在创建…' : '正在登录…'; }
  try {
    const response = register
      ? await api.register(username, password)
      : await api.login(username, password);
    const session = { token: response.token, user: response.user, savedAt: new Date().toISOString() };
    app.session = session;
    app.authenticated = true;
    app.authError = '';
    app.authNotice = '';
    app.ui.authUsername = response.user.username;
    saveSession(session);
    let local = { snapshot: null, ops: [] };
    try { local = await localDb.loadLocal(response.user.id); } catch { /* 忽略本机读失败 */ }
    if (local.ops?.length) {
      app.pendingOps = local.ops;
      app.state = local.snapshot?.state || response.state;
      app.revision = Number(local.snapshot?.revision) || 0;
      app.booted = true;
    } else {
      app.pendingOps = [];
      app.state = response.state;
      app.revision = Number(response.revision) || 1;
      app.booted = true;
    }
    persistLocal();
    if (app.route.name === 'practice') {
      history.replaceState(null, '', '#/home');
      app.route = { name: 'home', id: '', tail: '' };
    }
    render({ scrollTop: true });
    toast(register ? '词库建好了，里面已经放好第一批高频词。' : '登录好了，接着上次的进度继续。');
    syncNow();
  } catch (error) {
    showFormError('auth-form-error', error.message || '没有完成，请稍后再试。');
    if (submit) { submit.disabled = false; submit.textContent = register ? '创建并进入' : '登录'; }
  }
}

/* ==================== 词库 ==================== */

function openWordModal(word = null) {
  openModal(renderWordModal(app, word));
}

function handleWordSubmit(form) {
  clearFormError('word-form-error');
  const data = new FormData(form);
  const id = form.dataset.id || uid('word');
  const previous = id ? app.state.words[id] : null;
  const type = String(data.get('type') || '');
  const term = String(data.get('term') || '').trim();
  const definition = String(data.get('definition') || '').trim();
  const example = String(data.get('example') || '').trim();
  const source = String(data.get('source') || '').trim();
  const near = splitList(data.get('near'));
  const far = splitList(data.get('far'));
  if (!['idiom', 'word'].includes(type)) return showFormError('word-form-error', '请选择成语或实词。');
  if (!term) return showFormError('word-form-error', '请填写词语。');
  if (!definition) return showFormError('word-form-error', '请填写释义。');
  const conflict = activeWords(app.state).find((item) => item.id !== id && item.type === type && item.term === term);
  if (conflict) return showFormError('word-form-error', `词库里已经有“${term}”这个${type === 'idiom' ? '成语' : '实词'}，没有覆盖。`);
  const now = new Date().toISOString();
  const op = {
    opId: uid('word-op'),
    at: now,
    type: 'word.upsert',
    payload: {
      id, type, term, definition, example,
      source: source || '个人添加',
      near, far,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    },
  };
  app.modalNeedsRender = true;
  if (!dispatch(op, { render: false })) return;
  closeModal({ skipRender: true });
  app.modalNeedsRender = false;
  render({ keepScroll: true });
  toast(previous ? '词语已经改好。' : '词语已经加入你的词库。');
}

function splitList(value) {
  return [...new Set(String(value || '').split(/[、,，;；/]/).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
}

function openGroupModal(group = null) {
  openModal(renderGroupModal(app, group));
}

function handleGroupSubmit(form) {
  clearFormError('group-form-error');
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const note = String(data.get('note') || '').trim();
  const wordIds = data.getAll('wordIds').map(String);
  if (!name) return showFormError('group-form-error', '请给这一组起个名字。');
  if (wordIds.length < 2) return showFormError('group-form-error', '至少要选两个词才能成组。');
  if (wordIds.length > 40) return showFormError('group-form-error', '一组最多 40 个词。');
  const id = form.dataset.id || uid('group');
  const previous = app.state.groups[id];
  const now = new Date().toISOString();
  const op = {
    opId: uid('group-op'), at: now, type: 'group.upsert',
    payload: { id, name, note, wordIds, createdAt: previous?.createdAt || now, updatedAt: now },
  };
  app.modalNeedsRender = true;
  if (!dispatch(op, { render: false })) return;
  closeModal({ skipRender: true });
  app.modalNeedsRender = false;
  render({ keepScroll: true });
  toast(previous ? '这一组已经改好。' : '易混组已经建好。');
}

function deleteWord(wordId) {
  const word = app.state.words[wordId];
  if (!word) return;
  askConfirm({
    title: '把这个词移出词库？',
    message: `“${escapeHtml(word.term)}”将不再出现在你的词库和练习里。已有的学习记录会保留，不会被删掉。`,
    confirmLabel: '移出词库', danger: true,
    onConfirm: () => {
      const now = new Date().toISOString();
      dispatch({
        opId: uid('word-del'), at: now, type: 'word.delete',
        payload: { id: wordId, updatedAt: now },
      });
      toast('已经移出词库。');
    },
  });
}

function deleteGroup(groupId) {
  const group = app.state.groups[groupId];
  if (!group) return;
  askConfirm({
    title: '删除这个易混组？',
    message: `“${escapeHtml(group.name)}”会从列表里消失，组里的词和学习记录都还在。`,
    confirmLabel: '删除这组', danger: true,
    onConfirm: () => {
      const now = new Date().toISOString();
      dispatch({
        opId: uid('group-del'), at: now, type: 'group.delete',
        payload: { id: groupId, updatedAt: now },
      });
      app.study = null;
      routeTo('groups');
      toast('这一组已经删除。');
    },
  });
}

function importLocation(item) {
  if (!item) return '';
  if (item.where) return `${item.where}第 ${item.line || '?'} 行`;
  return item.line ? `第 ${item.line} 行` : '';
}

function setImportStatus(message, kind = '') {
  const box = document.getElementById('import-status');
  if (!box) return;
  box.hidden = !message;
  box.className = `import-status ${kind}`.trim();
  box.textContent = message || '';
}

function setImportBusy(busy) {
  app.importBusy = busy;
  const file = document.getElementById('import-file');
  const area = document.getElementById('import-text');
  if (file) file.disabled = busy;
  if (area) area.disabled = busy;
  updateImportButton();
}

function updateImportButton() {
  const button = document.getElementById('import-submit');
  if (!button) return;
  if (app.importBusy) {
    button.disabled = true;
    button.textContent = '正在读取…';
    return;
  }
  const count = document.querySelectorAll('#import-preview tbody tr').length;
  if (app.importDraft) {
    button.disabled = count === 0;
    button.innerHTML = `${icon('check', 15)}确认导入 ${count} 条`;
  } else {
    button.disabled = false;
    button.innerHTML = `${icon('upload', 15)}生成预览`;
  }
}

function importWarningsHtml(warnings) {
  if (!warnings?.length) return '';
  return `<div class="import-warn"><strong>提醒：</strong>${warnings.map((item) => `<div>${escapeHtml(item)}</div>`).join('')}</div>`;
}

function importSkipHtml(parsed) {
  const conflicts = parsed.conflicts || [];
  const errors = parsed.errors || [];
  const lines = [
    ...conflicts.slice(0, 30).map((item) => `${importLocation(item)}「${escapeHtml(item.term || '')}」：${escapeHtml(item.reason)}`),
    ...errors.slice(0, 30).map((item) => `${importLocation(item)}${escapeHtml(item.reason)}`),
  ];
  if (!lines.length) return '';
  return `<details class="import-skip" ${conflicts.length + errors.length <= 6 ? 'open' : ''}>
    <summary>跳过 ${conflicts.length + errors.length} 条（重复 ${conflicts.length}，不合格 ${errors.length}）</summary>
    <ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>
    ${conflicts.length + errors.length > 30 ? '<div class="small muted">只列出前 30 条。</div>' : ''}
  </details>`;
}

function renderImportPreview(parsed) {
  const box = document.getElementById('import-preview');
  if (!box) return;
  const rows = parsed.rows || [];
  const conflicts = parsed.conflicts || [];
  const errors = parsed.errors || [];
  const skipped = conflicts.length + errors.length;
  const warningHtml = importWarningsHtml(parsed.warnings || []);
  const skipHtml = importSkipHtml(parsed);

  box.hidden = false;
  box.innerHTML = `<div class="import-preview-head">
      <div><strong>导入预览</strong>
        <div class="small muted">将导入 <b id="import-keep-count">${rows.length}</b> 条；跳过 ${skipped} 条（重复 ${conflicts.length}，不合格 ${errors.length}）。确认前可以直接改下面的内容，或点垃圾桶去掉某条。</div>
      </div>
      <span class="pill">${parsed.sourceName ? escapeHtml(parsed.sourceName) : '当前内容'}</span>
    </div>
    ${warningHtml}
    ${skipHtml}
    ${rows.length ? `<div class="import-table-wrap"><table class="import-table"><thead><tr>
      <th>类型</th><th>词语</th><th>释义</th><th>例句</th><th>来源</th><th>近义</th><th>干扰</th><th aria-label="去掉"></th>
    </tr></thead><tbody>
      ${rows.map((row, index) => `<tr data-line="${attr(row.line || '')}" data-where="${attr(row.where || '')}">
        <td><select class="input" data-field="type" aria-label="类型">
          <option value="idiom" ${row.type === 'idiom' ? 'selected' : ''}>成语</option>
          <option value="word" ${row.type === 'word' ? 'selected' : ''}>实词</option>
        </select></td>
        <td><input class="input" data-field="term" value="${attr(row.term)}" aria-label="词语"></td>
        <td><textarea class="textarea" data-field="definition" rows="2" aria-label="释义">${escapeHtml(row.definition)}</textarea></td>
        <td><textarea class="textarea" data-field="example" rows="2" aria-label="例句">${escapeHtml(row.example)}</textarea></td>
        <td><input class="input" data-field="source" value="${attr(row.source)}" aria-label="来源"></td>
        <td><input class="input" data-field="near" value="${attr((row.near || []).join('、'))}" aria-label="近义"></td>
        <td><input class="input" data-field="far" value="${attr((row.far || []).join('、'))}" aria-label="干扰"></td>
        <td><button type="button" class="icon-btn import-remove" data-action="import-remove-row" aria-label="去掉这条">${icon('trash', 14)}</button></td>
      </tr>`).join('')}
    </tbody></table></div>` : '<div class="import-empty">没有找到可以导入的词条。看上面的原因；也可以改一改原文再生成预览。</div>'}
    ${rows.length ? `<div class="small muted import-tip">只有“同一类型 + 词语完全一样”才算重复；重复的那几条会跳过，不会覆盖已有词。没有释义的不会强行入库。</div>` : ''}`;
  updateImportButton();
}

async function handleImportFile(input) {
  const file = input.files?.[0];
  if (!file || app.importBusy) return;
  app.importDraft = null;
  clearFormError('import-error');
  const resultBox = document.getElementById('import-result');
  if (resultBox) { resultBox.hidden = true; resultBox.innerHTML = ''; }
  const preview = document.getElementById('import-preview');
  if (preview) { preview.hidden = true; preview.innerHTML = ''; }
  setImportBusy(true);
  setImportStatus(`正在读取「${file.name}」…`);
  try {
    const source = await readImportFile(file, {
      report: (message) => setImportStatus(message),
      progress: (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        const percent = Math.max(1, Math.min(99, Math.round(value * 100)));
        setImportStatus(`正在识别文字… ${percent}%`);
      },
    });
    const parsed = parseImportSource(source, activeWords(app.state));
    const textSnapshot = source.kind === 'text' ? source.text : '';
    const area = document.getElementById('import-text');
    if (area) area.value = textSnapshot;
    app.importDraft = {
      ...parsed,
      warnings: [...(parsed.warnings || []), ...(source.warnings || [])],
      textSnapshot,
      sourceName: file.name,
      sourceKind: source.kind,
      dirty: false,
    };
    renderImportPreview(app.importDraft);
    const skipped = parsed.conflicts.length + parsed.errors.length;
    if (parsed.rows.length) {
      setImportStatus(`已读取「${file.name}」：将导入 ${parsed.rows.length} 条，跳过 ${skipped} 条。核对后再点“确认导入”。`, 'ok');
    } else {
      setImportStatus(`已读取「${file.name}」，但没有找到能导入的词条。`, 'warn');
    }
  } catch (error) {
    if (!(error instanceof ImportFileError)) console.error('[import]', error);
    const message = error instanceof ImportFileError ? error.message : '这个文件没有读成功';
    const hint = error instanceof ImportFileError ? error.hint : '换一个文件再试，或把内容直接粘贴进来。';
    showFormError('import-error', hint ? `${message}。${hint}` : message);
    setImportStatus(message, 'error');
    app.importDraft = null;
  } finally {
    setImportBusy(false);
  }
}

function invalidateImportDraft() {
  if (!app.importDraft) return;
  const area = document.getElementById('import-text');
  if (area && area.value === app.importDraft.textSnapshot) return;
  app.importDraft = null;
  const preview = document.getElementById('import-preview');
  if (preview) { preview.hidden = true; preview.innerHTML = ''; }
  updateImportButton();
}

function collectPreviewRecords() {
  return [...document.querySelectorAll('#import-preview tbody tr')].map((row) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`)?.value || '';
    return {
      type: value('type'),
      term: value('term'),
      definition: value('definition'),
      example: value('example'),
      source: value('source'),
      near: value('near'),
      far: value('far'),
      line: Number(row.dataset.line) || 0,
      where: row.dataset.where || '',
    };
  });
}

function confirmImport() {
  clearFormError('import-error');
  const records = collectPreviewRecords();
  if (!records.length) return showFormError('import-error', '没有可以导入的词条。');
  const parsed = finalizeRecords(records, activeWords(app.state));
  if (!parsed.rows.length) {
    renderImportPreview({ ...parsed, warnings: app.importDraft?.warnings || [], sourceName: app.importDraft?.sourceName });
    const first = parsed.conflicts[0]?.reason || parsed.errors[0]?.reason || '没有找到可以导入的词条';
    showFormError('import-error', `这次没有导入新词：${first}。`);
    return;
  }
  const ops = buildImportOps(parsed.rows, uid);
  const outcome = dispatchMany(ops, { render: false });
  app.modalNeedsRender = true;
  const skipped = parsed.conflicts.length + parsed.errors.length;
  renderImportResult({ ...parsed, warnings: app.importDraft?.warnings || [] }, outcome.applied, skipped);
  const button = document.getElementById('import-submit');
  if (button) { button.disabled = true; button.innerHTML = `${icon('check', 15)}已导入`; }
  setImportStatus(`已导入 ${outcome.applied} 个词，跳过 ${skipped} 条。只写进你自己的词库。`, 'ok');
  app.importDraft = null;
  toast(`导入了 ${outcome.applied} 个词，跳过 ${skipped} 条。`);
}

function handleImportSubmit(form) {
  if (app.importBusy) return;
  clearFormError('import-error');
  const text = String(new FormData(form).get('text') || '').trim();
  const area = document.getElementById('import-text');
  if (app.importDraft && !app.importDraft.dirty && area && area.value === app.importDraft.textSnapshot) {
    confirmImport();
    return;
  }
  if (!text) return showFormError('import-error', '请先选择一个文件，或把词表内容粘贴进来。');
  setImportBusy(true);
  setImportStatus('正在整理词条，生成预览…');
  setTimeout(() => {
    try {
      const parsed = parseImport(text, activeWords(app.state));
      app.importDraft = {
        ...parsed,
        warnings: parsed.warnings || [],
        textSnapshot: text,
        sourceName: '粘贴内容',
        sourceKind: 'text',
        dirty: false,
      };
      renderImportPreview(app.importDraft);
      const skipped = parsed.conflicts.length + parsed.errors.length;
      if (parsed.rows.length) setImportStatus(`将导入 ${parsed.rows.length} 条，跳过 ${skipped} 条。核对后再点“确认导入”。`, 'ok');
      else setImportStatus('没有找到能导入的词条，请看下面的原因。', 'warn');
    } catch (error) {
      console.error('[import][text]', error);
      showFormError('import-error', '这段内容没有整理成功，可以检查一下格式再试。');
      setImportStatus('没有整理成功', 'error');
    } finally {
      setImportBusy(false);
    }
  }, 30);
}

function renderImportResult(parsed, imported, skippedCount = 0) {
  const box = document.getElementById('import-result');
  if (!box) return;
  const conflicts = parsed.conflicts || [];
  const errors = parsed.errors || [];
  const lines = [
    ...conflicts.slice(0, 30).map((item) => `${importLocation(item)}「${escapeHtml(item.term || '')}」：${escapeHtml(item.reason)}`),
    ...errors.slice(0, 30).map((item) => `${importLocation(item)}${escapeHtml(item.reason)}`),
  ];
  box.hidden = false;
  box.className = `import-result ${imported ? 'ok' : 'warn'}`;
  box.innerHTML = `<strong>${imported ? `成功导入 ${imported} 个词。` : '这次没有导入新词。'}</strong>
    ${skippedCount ? ` 跳过 ${skippedCount} 条${conflicts.length || errors.length ? `（重复 ${conflicts.length}，不合格 ${errors.length}）` : ''}。` : ''}
    ${lines.length ? `<ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>` : ''}
    ${imported ? '<div class="small" style="margin-top:8px">导入的词只在你自己的词库里，不会影响别人。关闭窗口后可在“我的词库”里找到。</div>' : ''}`;
}

/* ==================== 账号与备份 ==================== */

async function handleChangePassword(form) {
  clearFormError('password-error');
  const data = new FormData(form);
  const current = String(data.get('currentPassword') || '');
  const next = String(data.get('newPassword') || '');
  const again = String(data.get('newPassword2') || '');
  if (!current) return showFormError('password-error', '请输入现在的密码。');
  if (next.length < 6) return showFormError('password-error', '新密码至少 6 位。');
  if (next !== again) return showFormError('password-error', '两次输入的新密码不一样。');
  const button = form.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = '正在修改…'; }
  try {
    await api.changePassword(app.session.token, current, next);
    closeModal();
    toast('密码已经改好，其他设备需要用新密码重新登录。');
  } catch (error) {
    showFormError('password-error', error.message || '暂时没有改成，请稍后再试。');
    if (button) { button.disabled = false; button.textContent = '改好了'; }
  }
}

function exportData() {
  const payload = {
    app: 'yanyu-cishu',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { username: app.session?.user?.username || '' },
    state: app.state,
    pendingChanges: app.pendingOps.length,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const name = String(app.session?.user?.username || '词库').replace(/[\\/:*?"<>|]/g, '_');
  link.href = url;
  link.download = `言语词库备份-${name}-${localDay()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('备份已经开始下载。文件里不含密码。');
}

function doLogout() {
  if (app.localOnly) {
    toast('这是静态版，不用登录；数据只保存在这台浏览器。');
    return;
  }
  const pending = app.pendingOps.length;
  const message = pending
    ? `还有 ${pending} 条学习记录没有保存到账号。它们会先留在这台设备，下次用同一个账号登录会继续保存。确定现在退出吗？`
    : '下次用用户名和密码登录即可，词库和学习进度都会回来。';
  askConfirm({
    title: '要退出登录吗？',
    message,
    confirmLabel: '退出登录',
    onConfirm: async () => {
      try { if (app.online) await api.logout(app.session.token); } catch { /* 本机仍然退出 */ }
      saveSession(null);
      app.session = null;
      app.authenticated = false;
      app.state = null;
      app.pendingOps = [];
      app.study = null;
      app.revision = 0;
      app.authNotice = pending ? '上次退出时还有记录留在这台设备。用同一个账号登录后会继续保存。' : '';
      app.ui.authTab = 'login';
      history.replaceState(null, '', '#/home');
      app.route = { name: 'home', id: '', tail: '' };
      render({ scrollTop: true });
      toast('已经退出登录。');
    },
  });
}

/* ==================== 事件绑定 ==================== */

function bindEvents() {
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('online', () => {
    app.online = true;
    app.reachable = true;
    updateSyncBadges();
    if (app.localOnly) return;
    toast('网络恢复了，正在把记录保存好…');
    syncNow();
  });
  window.addEventListener('offline', () => {
    app.online = false;
    app.reachable = false;
    updateSyncBadges();
    if (app.localOnly) return;
    toast('现在没有网络。学习记录会先放在这台设备，联网后自动保存。', 'warn');
  });
  document.addEventListener('visibilitychange', () => {
    if (app.localOnly) {
      if (document.visibilityState === 'hidden') persistLocal();
      return;
    }
    if (document.visibilityState === 'visible' && app.session && app.state) syncNow();
    else persistLocal();
  });
  window.addEventListener('pagehide', persistLocal);
}

function handleClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) {
    if (event.target.closest('a[href^="#/"]')) closeModal({ skipRender: true });
    return;
  }
  const tag = actionEl.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(tag)) return;
  const action = actionEl.dataset.action;
  if (action && action !== 'close-modal-link' && action !== 'modal-backdrop') event.preventDefault();
  switch (action) {
    case 'modal-backdrop':
      if (event.target === actionEl) closeModal();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'close-modal-link':
      closeModal({ skipRender: true });
      break;
    case 'confirm-modal': {
      const handler = app.confirmHandler;
      closeModal({ skipRender: true });
      app.modalNeedsRender = false;
      if (handler) handler();
      break;
    }
    case 'auth-tab':
      app.ui.authTab = actionEl.dataset.tab === 'register' ? 'register' : 'login';
      app.authError = '';
      app.authNotice = '';
      render();
      break;
    case 'set-practice-mode':
      patchSettings({ practiceMode: actionEl.dataset.value === 'cloze' ? 'cloze' : 'reveal' });
      render({ keepScroll: true });
      break;
    case 'set-scope': {
      const scope = ['all', 'idiom', 'word'].includes(actionEl.dataset.value) ? actionEl.dataset.value : 'all';
      patchSettings({ scope });
      render({ keepScroll: true });
      break;
    }
    case 'start-daily': startStudy('daily'); break;
    case 'start-review': startStudy('review'); break;
    case 'start-new': startStudy('new'); break;
    case 'start-group': startGroup(actionEl.dataset.id); break;
    case 'start-mistakes': startMistakes(); break;
    case 'restart-mistakes': startMistakes(); break;
    case 'practice-word': startSingle(actionEl.dataset.id); break;
    case 'new-word': openWordModal(); break;
    case 'view-word': {
      const word = app.state.words[actionEl.dataset.id];
      if (word) openModal(renderWordDetail(app, word));
      break;
    }
    case 'edit-word': {
      const word = app.state.words[actionEl.dataset.id];
      if (word) openWordModal(word);
      break;
    }
    case 'delete-word': deleteWord(actionEl.dataset.id); break;
    case 'open-import':
      app.importDraft = null;
      app.importBusy = false;
      openModal(renderImportModal());
      break;
    case 'import-remove-row': {
      const row = actionEl.closest('tr');
      if (row) row.remove();
      const count = document.querySelectorAll('#import-preview tbody tr').length;
      const label = document.getElementById('import-keep-count');
      if (label) label.textContent = String(count);
      clearFormError('import-error');
      updateImportButton();
      break;
    }
    case 'new-group': openGroupModal(); break;
    case 'edit-group': openGroupModal(app.state.groups[actionEl.dataset.id]); break;
    case 'delete-group': deleteGroup(actionEl.dataset.id); break;
    case 'remove-mistake': {
      dispatch({
        opId: uid('mistake'), at: new Date().toISOString(), type: 'mistake.remove',
        payload: { wordId: actionEl.dataset.id },
      });
      toast('已经移出错词本，学习记录仍然保留。');
      break;
    }
    case 'word-type':
      app.ui.wordType = actionEl.dataset.value || 'all';
      render({ keepScroll: true });
      break;
    case 'clear-word-search':
      app.ui.wordSearch = '';
      render({ keepScroll: true });
      break;
    case 'change-password': openModal(renderPasswordModal()); break;
    case 'export-data': exportData(); break;
    case 'manual-sync':
      if (!navigator.onLine) showToast('现在没有网络，记录已经先放在这台设备。', 'warn');
      else syncNow({ manual: true });
      break;
    case 'logout': doLogout(); break;
    case 'reveal': handleReveal(); break;
    case 'rate': handleRate(actionEl.dataset.rating); break;
    case 'check-dictation': handleDictation(); break;
    case 'synonym-choice': handleSynonym(actionEl.dataset.value); break;
    case 'cloze-choice': handleCloze(actionEl.dataset.value); break;
    case 'next-card': handleNext(); break;
    case 'exit-practice': exitPractice(); break;
    default: break;
  }
}

function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!['auth-form', 'word-form', 'group-form', 'import-form', 'password-form'].includes(form.id)) return;
  event.preventDefault();
  if (form.id === 'auth-form') handleAuthSubmit(form);
  else if (form.id === 'word-form') handleWordSubmit(form);
  else if (form.id === 'group-form') handleGroupSubmit(form);
  else if (form.id === 'import-form') handleImportSubmit(form);
  else if (form.id === 'password-form') handleChangePassword(form);
}

function handleInput(event) {
  const target = event.target;
  if (target.id === 'auth-username') app.ui.authUsername = target.value;
  else if (target.id === 'word-search') {
    app.ui.wordSearch = target.value;
    const list = document.getElementById('word-list');
    if (list) list.innerHTML = renderWordList(app);
  } else if (target.id === 'dictation-input' && app.study?.current) {
    app.study.current.dictationAnswer = target.value;
  } else if (target.id === 'mistake-search') {
    app.ui.mistakeSearch = target.value;
    clearTimeout(mistakeSearchTimer);
    mistakeSearchTimer = setTimeout(() => render({ keepScroll: true }), 180);
  } else if (target.id === 'import-text') {
    invalidateImportDraft();
  }
}

function handleChange(event) {
  const target = event.target;
  if (target.id === 'import-file') { handleImportFile(target); return; }
  if (target.matches('[data-setting]')) {
    const setting = target.dataset.setting;
    const value = target.value;
    const patch = {};
    patch[setting] = value;
    patchSettings(patch);
    render({ keepScroll: true });
    return;
  }
  if (target.matches('[data-action="daily-new-limit"]')) {
    const value = Math.max(0, Math.min(100, Number(target.value) || 0));
    target.value = value;
    patchSettings({ dailyNewLimit: value });
    render({ keepScroll: true });
    toast(`每天新学上限改为 ${value} 个。`);
    return;
  }
  if (target.matches('[data-action="review-daily-limit"]')) {
    const value = Math.max(5, Math.min(200, Number(target.value) || 30));
    target.value = value;
    patchSettings({ reviewDailyLimit: value });
    render({ keepScroll: true });
    toast(`每天复习上限改为 ${value} 个。`);
    return;
  }
  if (target.matches('[data-action="group-check"]')) {
    const count = document.querySelectorAll('#group-form input[name="wordIds"]:checked').length;
    const label = document.getElementById('group-count');
    if (label) label.textContent = `已选 ${count} 个`;
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    if (document.getElementById('modal-root')?.innerHTML) closeModal();
    return;
  }
  if (event.target.id === 'dictation-input' && event.key === 'Enter') {
    event.preventDefault();
    handleDictation();
  }
}

// 防止误用未使用的导入（构建检查）
init().catch((error) => {
  console.error(error);
  document.getElementById('app').innerHTML = `<div class="boot-screen"><div class="boot-mark">言</div><p>页面没有打开成功，请刷新再试。</p></div>`;
});
