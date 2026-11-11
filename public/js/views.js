import { icon } from './icons.js';
import {
  activeGroups, activeWords, dueWords, groupsForWord, mistakeEntries, stats, todayPlan,
  TYPE_LABELS, wordProgress,
} from '../shared/selectors.mjs';
import { localDay } from '../shared/schedule.mjs';
import {
  attr, escapeHtml, formatDateCN, formatDateTimeCN, highlightTerm, initials,
} from './util.js';

const NAV = [
  { route: 'home', label: '今日学习', icon: 'home' },
  { route: 'words', label: '我的词库', icon: 'book' },
  { route: 'groups', label: '易混对比', icon: 'layers' },
  { route: 'mistakes', label: '错词本', icon: 'mistake' },
  { route: 'stats', label: '学习统计', icon: 'chart' },
  { route: 'settings', label: '设置', icon: 'settings' },
];

export { NAV };

export function syncLabel(app) {
  if (app.localOnly) {
    if (!app.storageAvailable) return { cls: 'offline', text: '本机存储不可用', icon: 'cloudOff' };
    return { cls: 'local', text: '已存在本机', icon: 'lock' };
  }
  if (!app.online) return { cls: 'offline', text: '离线 · 稍后自动保存', icon: 'cloudOff' };
  if (app.syncing) return { cls: 'pending', text: '正在保存…', icon: 'refresh' };
  if (app.pendingOps.length) return { cls: 'pending', text: `还有 ${app.pendingOps.length} 条等联网保存`, icon: 'cloudOff' };
  if (app.sync.lastError) return { cls: 'offline', text: '稍后会自动再保存', icon: 'cloudOff' };
  return { cls: 'online', text: '已保存', icon: 'cloud' };
}

function syncChip(app, extraClass = '') {
  const state = syncLabel(app);
  const title = app.localOnly ? '只保存在这台设备的浏览器里' : '学习记录会自动保存';
  return `<span class="sync-chip ${state.cls} ${extraClass}" data-sync-chip title="${title}">${icon(state.icon, 13)}${escapeHtml(state.text)}</span>`;
}

export function renderAuth(app) {
  const register = app.ui.authTab === 'register';
  const error = app.authError
    ? `<p class="form-error show" id="auth-error">${escapeHtml(app.authError)}</p>` : '';
  return `
  <main id="main" class="auth-page">
    <section class="auth-story">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">言</span>
        <div><strong>言语词库</strong><span>成语 · 实词</span></div>
      </div>
      <div class="auth-quote">
        <div class="kicker">公务员 · 事业单位 · 言语理解</div>
        <h1>一字之差，<br>语义<em>千里</em>。</h1>
        <p>把容易混的成语和实词，放进自己的词库。每天复习一点，日子久了，语感会替你记住。</p>
      </div>
      <div class="auth-features">
        <div class="auth-feature"><span class="tick">✓</span><span>每人一份独立词库，学习进度跟着账号走。</span></div>
        <div class="auth-feature"><span class="tick">✓</span><span>第一次登录后，断网也能继续学，联网自动保存。</span></div>
        <div class="auth-feature"><span class="tick">✓</span><span>先想再揭晓，或直接在句子里选词，由你决定。</span></div>
      </div>
    </section>
    <section class="auth-panel">
      <div class="auth-card">
        <div class="auth-tabs" role="tablist" aria-label="登录或注册">
          <button class="auth-tab ${register ? '' : 'active'}" data-action="auth-tab" data-tab="login" role="tab" aria-selected="${!register}">登录</button>
          <button class="auth-tab ${register ? 'active' : ''}" data-action="auth-tab" data-tab="register" role="tab" aria-selected="${register}">第一次使用</button>
        </div>
        <h2>${register ? '建一个自己的词库' : '欢迎回来'}</h2>
        <p class="auth-sub">${register ? '只需用户名和密码，不用手机号，也不用邮箱。' : '登录后，你的词库和学习进度会回到上次的位置。'}</p>
        ${app.authNotice ? `<p class="modal-intro">${escapeHtml(app.authNotice)}</p>` : ''}
        ${error}
        <form id="auth-form" novalidate>
          <div class="field">
            <label for="auth-username">用户名</label>
            <input class="input" id="auth-username" name="username" autocomplete="username" required minlength="2" maxlength="24" value="${attr(app.ui.authUsername || '')}" placeholder="例如：文轩">
            <span class="hint">2—24 个字，中文、字母、数字都可以。</span>
          </div>
          <div class="field">
            <label for="auth-password">密码</label>
            <input class="input" id="auth-password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="6" maxlength="128" placeholder="至少 6 位">
          </div>
          ${register ? `
          <div class="field">
            <label for="auth-password2">再输一遍密码</label>
            <input class="input" id="auth-password2" name="password2" type="password" autocomplete="new-password" required minlength="6" maxlength="128" placeholder="两次输入要一样">
          </div>` : ''}
          <p class="form-error" id="auth-form-error" role="alert"></p>
          <button class="btn primary block large" id="auth-submit" type="submit">${register ? '创建并进入' : '登录'}</button>
        </form>
        ${register ? `<p class="auth-note">创建后会得到一份约 60 个高频成语和实词的初始词库。之后你改动、导入或删除，都只影响自己的这一份。</p>` : ''}
        <p class="auth-note">第一次登录需要联网。登录成功后，即使断网，也能继续学习；重新联网时会自动保存。</p>
        <p class="auth-footer">一个安静的个人学习工具 · 不用付费</p>
      </div>
    </section>
  </main>`;
}

function navLink(item, app, mobile = false) {
  const current = app.route.name === item.route
    || (item.route === 'groups' && app.route.name === 'group')
    || (item.route === 'home' && app.route.name === 'practice');
  let count = 0;
  if (item.route === 'mistakes') count = stats(app.state).mistakeCount;
  if (mobile) {
    return `<a class="bottom-link ${current ? 'active' : ''}" href="#/${item.route}" ${current ? 'aria-current="page"' : ''}>
      ${icon(item.icon, 19)}<span>${item.label.replace('今日学习', '学习').replace('我的词库', '词库').replace('易混对比', '易混').replace('学习统计', '统计')}</span>
      ${item.route === 'mistakes' && count ? '<i class="bottom-dot"></i>' : ''}
    </a>`;
  }
  return `<li><a class="nav-item ${current ? 'active' : ''}" href="#/${item.route}" ${current ? 'aria-current="page"' : ''}>
    ${icon(item.icon)}<span>${item.label}</span>${item.route === 'mistakes' && count ? `<span class="nav-count">${count}</span>` : ''}
  </a></li>`;
}

export function renderShell(app, content, options = {}) {
  const state = app.state;
  const due = dueWords(state, localDay(), 'all').length;
  const currentName = app.route.name;
  return `
  <div class="app-shell">
    <aside class="sidebar" aria-label="主导航">
      <a class="sidebar-brand" href="#/home" style="text-decoration:none;color:inherit">
        <span class="brand-mark" aria-hidden="true">言</span>
        <div><strong>言语词库</strong><span>成语 · 实词</span></div>
      </a>
      <nav>
        <ul class="nav-list">${NAV.map((item) => navLink(item, app)).join('')}</ul>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-user">
          <span class="avatar">${escapeHtml(initials(app.session?.user?.username))}</span>
          <div><strong>${escapeHtml(app.session?.user?.username || '')}</strong><span>${due ? `${due} 个词待复习` : '今日复习已清空'}</span></div>
        </div>
        ${app.localOnly
          ? '<p class="sidebar-motto">不用登录 · 只保存在这台浏览器</p>'
          : '<button class="sidebar-logout" data-action="logout">退出登录</button>'}
        <p class="sidebar-motto">“温故而知新，可以为师矣。”</p>
      </div>
    </aside>
    <div class="main-wrap">
      <header class="mobile-head">
        <a class="mobile-brand" href="#/home" aria-label="回到首页">
          <span class="brand-mark" aria-hidden="true">言</span><strong>言语词库</strong>
        </a>
        <div class="mobile-head-right">
          ${syncChip(app)}
          <a class="avatar mobile-avatar" href="#/settings" aria-label="设置">${escapeHtml(initials(app.session?.user?.username))}</a>
        </div>
      </header>
      <main class="main" id="main">${content}</main>
    </div>
  </div>
  ${options.noBottomNav ? '' : `<nav class="bottom-nav" aria-label="手机导航">${NAV.map((item) => navLink(item, app, true)).join('')}</nav>`}`;
}

export function renderHome(app) {
  const state = app.state;
  const day = localDay();
  const plan = todayPlan(state, day);
  const s = stats(state, day);
  const settings = state.settings;
  const noPlan = plan.total === 0;
  let headline;
  if (plan.due.length && plan.fresh.length) {
    headline = `先复习 <em>${plan.due.length}</em> 个旧词，<br>再认识 <em>${plan.fresh.length}</em> 个新词。`;
  } else if (plan.due.length) {
    headline = `今天有 <em>${plan.due.length}</em> 个词，<br>正等着和你再见一面。`;
  } else if (plan.fresh.length) {
    headline = `今天没有到期复习，<br>正好认识 <em>${plan.fresh.length}</em> 个新词。`;
  } else if (plan.dueAll.length) {
    headline = `今天的复习量已经完成，<br>还有 <em>${plan.dueRemaining.length}</em> 个可以留到后面。`;
  } else {
    headline = `今天的任务已经清空，<br>可以歇一会儿，或去词库转转。`;
  }
  const last14 = s.thirtyDays.slice(-14);
  const weekday = ['一', '二', '三', '四', '五', '六', '日'];
  return `<div class="page">
    <div class="page-head">
      <div>
        <div class="eyebrow">${formatDateCN(day)}</div>
        <h1>${greeting()}，${escapeHtml(app.session?.user?.username || '同学')}</h1>
        <p>${plan.total ? `今天计划学习 ${plan.total} 个词，约 ${Math.max(3, Math.ceil(plan.total * 0.55))} 分钟。` : '今天没有必须完成的学习任务。'}</p>
      </div>
      <div class="page-actions">${syncChip(app)}<a class="btn small" href="#/settings">${icon('settings', 15)}调整计划</a></div>
    </div>
    <section class="hero" aria-labelledby="today-title">
      <div class="hero-copy">
        <div class="eyebrow">今日计划</div>
        <h1 id="today-title">${headline}</h1>
        <p class="hero-sub">${plan.reviewMode === 'clear' ? '到期复习，今天清完；新学的词会按记忆规律安排下次见面。' : `到期复习可以留到后面，今天先完成 ${plan.due.length} 个。`}</p>
        <div class="plan-counts">
          <div class="plan-count ${plan.due.length ? '' : 'zero'}"><strong>${plan.due.length}</strong><span>今日复习</span></div>
          <div class="plan-count gold ${plan.fresh.length ? '' : 'zero'}"><strong>${plan.fresh.length}</strong><span>今日新学</span></div>
          <div class="plan-count"><strong>${s.streak}</strong><span>连续学习 · 天</span></div>
        </div>
        <div class="hero-controls">
          <div class="control-group">
            <span class="control-label">练习方式</span>
            <div class="segmented" role="group" aria-label="练习方式">
              <button class="segment ${settings.practiceMode === 'reveal' ? 'active' : ''}" data-action="set-practice-mode" data-value="reveal" aria-pressed="${settings.practiceMode === 'reveal'}">先想再揭晓</button>
              <button class="segment ${settings.practiceMode === 'cloze' ? 'active' : ''}" data-action="set-practice-mode" data-value="cloze" aria-pressed="${settings.practiceMode === 'cloze'}">句中选词</button>
            </div>
          </div>
          <div class="control-group">
            <span class="control-label">练习范围</span>
            <div class="segmented" role="group" aria-label="练习范围">
              <button class="segment ${settings.scope === 'all' ? 'active' : ''}" data-action="set-scope" data-value="all">混合</button>
              <button class="segment ${settings.scope === 'idiom' ? 'active' : ''}" data-action="set-scope" data-value="idiom">只练成语</button>
              <button class="segment ${settings.scope === 'word' ? 'active' : ''}" data-action="set-scope" data-value="word">只练实词</button>
            </div>
          </div>
        </div>
        <div class="hero-actions">
          <button class="btn primary large" data-action="start-daily" ${noPlan ? 'disabled' : ''}>${icon('play', 17)}${noPlan ? '今天已经清空' : '开始今日学习'}</button>
          ${plan.dueAll.length ? `<button class="btn ghost" data-action="start-review">只练到期复习</button>` : ''}
          ${plan.newAll.length ? `<button class="btn ghost" data-action="start-new">只学新词</button>` : ''}
        </div>
        <p class="hero-note">${icon('info', 14)} ${plan.reviewMode === 'clear' ? '复习模式：当天清完' : `复习模式：可以留到后面（每天最多 ${settings.reviewDailyLimit} 个）`} · 每天新学上限 ${settings.dailyNewLimit} 个</p>
      </div>
      <aside class="hero-aside">
        <div class="streak-ring"><div><strong>${s.streak}</strong><span>连续天数</span></div></div>
        <p class="streak-caption">${s.checkedIn ? '今天已经打过卡。' : '完成一个词，就算今天打过卡。'}<br><b>最长连续 ${s.longestStreak} 天</b></p>
      </aside>
    </section>
    <section class="stats-grid" aria-label="学习概览">
      ${statCard('待复习', s.dueCount, s.overdue ? `其中 ${s.overdue} 个已到期` : '按计划复习', 'clock')}
      ${statCard('已学词', s.learnedCount, `词库共 ${s.totalWords} 个`, 'bookMark')}
      ${statCard('今日已学', s.today.total, `新学 ${s.today.newCount} 个`, 'target')}
      ${statCard('错词本', s.mistakeCount, s.mistakeCount ? '记得回头再看' : '保持得很好', 'mistake')}
    </section>
    <div class="home-grid">
      <section class="card calendar-card">
        <div class="calendar-title"><h2>最近两周</h2><span>每天学一个词，也算数</span></div>
        <div class="day-dots">
          ${last14.map((item) => {
            const date = new Date(`${item.date}T00:00:00`);
            const done = item.total > 0;
            return `<div class="day-dot ${done ? 'done' : ''} ${item.date === day ? 'today' : ''}" title="${formatDateCN(item.date)}${done ? ` · 学习 ${item.total} 次` : ' · 未学习'}">
              <i>${date.getDate()}</i>${weekday[(date.getDay() + 6) % 7]}
            </div>`;
          }).join('')}
        </div>
        <div class="calendar-foot">
          <span><b>${s.recent30}</b> 次 · 近 30 天</span>
          <span><b>${s.knownRate}%</b> · 自评“认识”占比</span>
        </div>
      </section>
      <div class="quick-links">
        <a class="quick-link" href="#/groups">
          <span class="quick-icon gold">${icon('layers', 18)}</span>
          <span><strong>易混组对比</strong><span>${activeGroups(state).length} 组，成组辨一辨</span></span>
          <span class="chev">${icon('chevronRight', 16)}</span>
        </a>
        <a class="quick-link" href="#/mistakes">
          <span class="quick-icon cinnabar">${icon('mistake', 18)}</span>
          <span><strong>错词本</strong><span>${s.mistakeCount ? `${s.mistakeCount} 个词等你回看` : '暂时没有错词'}</span></span>
          <span class="chev">${icon('chevronRight', 16)}</span>
        </a>
        <a class="quick-link" href="#/stats">
          <span class="quick-icon">${icon('chart', 18)}</span>
          <span><strong>学习统计</strong><span>连续天数、到期数量一目了然</span></span>
          <span class="chev">${icon('chevronRight', 16)}</span>
        </a>
      </div>
    </div>
    ${plan.dueRemaining.length ? `<div class="due-note">${icon('clock', 16)}<span><strong>还有 ${plan.dueRemaining.length} 个到期词没放进今天的复习。</strong> 你选的是“可以留到后面”，想今天清完，可以在设置里改成“当天清完”。</span></div>` : ''}
  </div>`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function statCard(label, value, extra, iconName) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span>${icon(iconName, 16)}</div><div class="stat-value">${value}</div><div class="stat-extra">${escapeHtml(extra)}</div></article>`;
}

export function filteredWords(app) {
  const query = (app.ui.wordSearch || '').trim().toLowerCase();
  const type = app.ui.wordType || 'all';
  return activeWords(app.state)
    .filter((word) => (type === 'all' || word.type === type)
      && (!query || word.term.toLowerCase().includes(query) || word.definition.toLowerCase().includes(query)))
    .sort((a, b) => a.id.localeCompare(b.id, 'zh-CN', { numeric: true }));
}

function statusBadge(app, word) {
  const progress = wordProgress(app.state, word.id);
  if (!progress.learnedAt) return '<span class="progress-badge new">新词</span>';
  if (progress.dueDate && progress.dueDate <= localDay()) return '<span class="progress-badge review">待复习</span>';
  const labels = { learning: '学习中', review: '复习中', mastered: '已掌握' };
  return `<span class="progress-badge ${attr(progress.status)}">${labels[progress.status] || '复习中'}</span>`;
}

function dueText(app, word) {
  const progress = app.state.progress[word.id];
  if (!progress?.learnedAt) return '还没有学';
  if (progress.dueDate < localDay()) return `已到期 ${formatDateCN(progress.dueDate, { short: true })}`;
  if (progress.dueDate === localDay()) return '今天复习';
  return `下次 ${formatDateCN(progress.dueDate, { short: true })}`;
}

function groupChips(app, word) {
  const groups = groupsForWord(app.state, word.id);
  if (!groups.length) return '';
  return `<div class="group-chips">${groups.slice(0, 3).map((group) => `<span class="mini-chip">${escapeHtml(group.name)}</span>`).join('')}</div>`;
}

function wordRow(app, word) {
  return `<div class="word-row">
    <div>
      <div class="term-line"><button class="term-link" data-action="view-word" data-id="${attr(word.id)}"><strong>${escapeHtml(word.term)}</strong></button><span class="type-badge ${attr(word.type)}">${TYPE_LABELS[word.type]}</span></div>
      <div class="due-date">${escapeHtml(dueText(app, word))}</div>
    </div>
    <div class="def-snippet">${escapeHtml(word.definition)}</div>
    <div class="group-cell">${groupChips(app, word)}</div>
    <div>${statusBadge(app, word)}</div>
    <div class="row-actions">
      <button class="icon-btn" data-action="edit-word" data-id="${attr(word.id)}" aria-label="编辑 ${attr(word.term)}">${icon('edit', 15)}</button>
      <button class="icon-btn" data-action="delete-word" data-id="${attr(word.id)}" aria-label="移出 ${attr(word.term)}">${icon('trash', 15)}</button>
    </div>
  </div>`;
}

function wordCard(app, word) {
  return `<article class="word-card">
    <div class="word-card-top">
      <div>
        <div class="term-line"><button class="term-link" data-action="view-word" data-id="${attr(word.id)}"><strong>${escapeHtml(word.term)}</strong></button><span class="type-badge ${attr(word.type)}">${TYPE_LABELS[word.type]}</span></div>
        <div class="due-date">${escapeHtml(dueText(app, word))}</div>
      </div>
      ${statusBadge(app, word)}
    </div>
    <p class="def-snippet">${escapeHtml(word.definition)}</p>
    ${groupChips(app, word)}
    <div class="word-card-foot">
      <span class="small muted">${escapeHtml(word.source || '个人词库')}</span>
      <div class="word-card-actions">
        <button class="icon-btn" data-action="edit-word" data-id="${attr(word.id)}" aria-label="编辑">${icon('edit', 16)}</button>
        <button class="icon-btn" data-action="delete-word" data-id="${attr(word.id)}" aria-label="移出词库">${icon('trash', 16)}</button>
      </div>
    </div>
  </article>`;
}

export function renderWordList(app) {
  const words = filteredWords(app);
  return `<div class="result-line"><span>筛出 <b>${words.length}</b> 个词</span><span>点词条可看完整释义</span></div>
    ${words.length ? `<div class="word-table" role="list">${words.map((word) => wordRow(app, word)).join('')}</div>
    <div class="word-list-mobile">${words.map((word) => wordCard(app, word)).join('')}</div>`
      : `<div class="empty-state"><div class="empty-mark">找</div><h2>没有找到这个词</h2><p>换个关键词，或点右上角添加一个新词。</p><button class="btn" data-action="clear-word-search">清除筛选</button></div>`}`;
}

export function renderWords(app) {
  const all = activeWords(app.state);
  return `<div class="page">
    <div class="page-head">
      <div><div class="eyebrow">个人词库</div><h1>我的词库</h1><p>共 ${all.length} 个词：成语 ${all.filter((w) => w.type === 'idiom').length} 个，实词 ${all.filter((w) => w.type === 'word').length} 个。只有你能看到和修改。</p></div>
      <div class="page-actions">
        <button class="btn" data-action="open-import">${icon('upload', 15)}导入词表</button>
        <button class="btn primary" data-action="new-word">${icon('plus', 15)}添加词语</button>
      </div>
    </div>
    <div class="toolbar">
      <label class="search-field"><span class="sr-only">搜索词语或释义</span>${icon('search', 16)}<input class="input" id="word-search" data-action="word-search" type="search" placeholder="搜词语或释义…" value="${attr(app.ui.wordSearch || '')}"></label>
      <div class="segmented" role="group" aria-label="按类型筛选">
        ${['all', 'idiom', 'word'].map((value) => `<button class="segment ${app.ui.wordType === value ? 'active' : ''}" data-action="word-type" data-value="${value}">${value === 'all' ? '全部' : TYPE_LABELS[value]}</button>`).join('')}
      </div>
      <div class="toolbar-right"><span class="small muted">词库是私人的</span></div>
    </div>
    <div id="word-list">${renderWordList(app)}</div>
  </div>`;
}

export function renderGroups(app) {
  const groups = activeGroups(app.state);
  return `<div class="page">
    <div class="page-head">
      <div><div class="eyebrow">放在一起才看得清</div><h1>易混对比</h1><p>每组大约 10 个词。先看对比，再成组练习，专门分辨那些“好像都行”的词。</p></div>
      <div class="page-actions"><button class="btn primary" data-action="new-group">${icon('plus', 15)}新建易混组</button></div>
    </div>
    ${groups.length ? `<div class="group-grid">${groups.map((group) => {
      const words = group.wordIds.map((id) => app.state.words[id]).filter((word) => word && !word.deletedAt);
      return `<article class="card group-card">
        <div class="group-card-head"><h2>${escapeHtml(group.name)}</h2><span class="count">${words.length} 个词</span></div>
        <p class="group-note">${escapeHtml(group.note || '把容易混的词放在一起，对照着看。')}</p>
        <div class="group-chips large">${words.slice(0, 6).map((word) => `<span class="mini-chip">${escapeHtml(word.term)}</span>`).join('')}${words.length > 6 ? `<span class="mini-chip">等 ${words.length} 个</span>` : ''}</div>
        <div class="group-card-footer">
          <a class="btn small" href="#/group/${attr(group.id)}">${icon('eye', 14)}看对比</a>
          <button class="btn small primary" data-action="start-group" data-id="${attr(group.id)}" ${words.length < 2 ? 'disabled' : ''}>${icon('play', 13)}开始练习</button>
        </div>
      </article>`;
    }).join('')}</div>`
      : `<div class="empty-state"><div class="empty-mark">组</div><h2>还没有易混组</h2><p>新建一组，把总也分不清的词放在一起。</p><button class="btn primary" data-action="new-group">新建易混组</button></div>`}
  </div>`;
}

export function renderGroupDetail(app) {
  const group = app.state.groups[app.route.id];
  if (!group || group.deletedAt) return renderNotFound(app);
  const words = group.wordIds.map((id) => app.state.words[id]).filter((word) => word && !word.deletedAt);
  return `<div class="page">
    <div class="page-head" style="margin-bottom:14px">
      <div><div class="eyebrow"><a href="#/groups">易混对比</a> / 组内辨析</div></div>
      <div class="page-actions"><button class="btn small" data-action="edit-group" data-id="${attr(group.id)}">${icon('edit', 14)}编辑这组</button></div>
    </div>
    <section class="group-detail-head">
      <div><div class="crumb">${words.length} 个词 · 成组对比</div><h1>${escapeHtml(group.name)}</h1><p>${escapeHtml(group.note || '把容易混的词放在一起，对照着看。')}</p></div>
      <button class="btn primary" data-action="start-group" data-id="${attr(group.id)}" ${words.length < 2 ? 'disabled' : ''}>${icon('play', 15)}开始对比练习</button>
    </section>
    ${words.length >= 2 ? `<div class="card compare-table">
      <div class="compare-row head"><span>词语</span><span>释义</span><span>例句</span></div>
      ${words.map((word) => `<div class="compare-row">
        <div class="compare-term"><strong>${escapeHtml(word.term)}</strong><div><span class="type-badge ${attr(word.type)}">${TYPE_LABELS[word.type]}</span></div></div>
        <div class="compare-def">${escapeHtml(word.definition)}</div>
        <div class="compare-example">${highlightTerm(word.example, word.term)}${word.source ? `<div class="source-line">${escapeHtml(word.source)}</div>` : ''}</div>
      </div>`).join('')}
    </div>` : `<div class="empty-state"><div class="empty-mark">组</div><h2>这一组还不够练习</h2><p>至少放入两个词，才能做对比练习。</p><button class="btn" data-action="edit-group" data-id="${attr(group.id)}">编辑这组</button></div>`}
    <div class="page-actions" style="margin-top:14px"><a class="btn ghost" href="#/groups">${icon('arrowLeft', 15)}回到易混组</a><button class="btn ghost danger" data-action="delete-group" data-id="${attr(group.id)}">${icon('trash', 14)}删除这组</button></div>
  </div>`;
}

export function renderMistakes(app) {
  const query = (app.ui.mistakeSearch || '').trim().toLowerCase();
  const all = mistakeEntries(app.state);
  const entries = all.filter((item) => !query || item.word.term.toLowerCase().includes(query) || item.word.definition.toLowerCase().includes(query));
  return `<div class="page">
    <div class="page-head">
      <div><div class="eyebrow">回头再看一眼</div><h1>错词本</h1><p>忘记、默写错、选错近义项或句中选错，都会自动收进来。移出后不会再显示，但学习记录仍保留。</p></div>
      <div class="page-actions"><button class="btn primary" data-action="start-mistakes" ${all.length ? '' : 'disabled'}>${icon('play', 15)}练一遍错词</button></div>
    </div>
    ${all.length ? `<div class="toolbar"><label class="search-field"><span class="sr-only">搜索错词</span>${icon('search', 16)}<input class="input" id="mistake-search" data-action="mistake-search" type="search" placeholder="搜错词…" value="${attr(app.ui.mistakeSearch || '')}"></label><div class="toolbar-right"><span class="small muted">共 ${all.length} 个错词</span></div></div>` : ''}
    ${entries.length ? `<div class="mistake-list">${entries.map((item) => `<article class="mistake-item">
      <div><div class="term-line"><strong>${escapeHtml(item.word.term)}</strong><span class="type-badge ${attr(item.word.type)}">${TYPE_LABELS[item.word.type]}</span></div><div class="due-date">${escapeHtml(dueText(app, item.word))}</div></div>
      <div class="def-snippet">${escapeHtml(item.word.definition)}</div>
      <div class="wrong-count"><strong>${item.wrongCount}</strong><span>次出错</span></div>
      <div class="mistake-date">最近 ${formatDateTimeCN(item.lastWrongAt)}</div>
      <div class="mistake-actions"><button class="btn small" data-action="practice-word" data-id="${attr(item.word.id)}">${icon('play', 13)}练这个词</button><button class="btn small ghost" data-action="remove-mistake" data-id="${attr(item.word.id)}">移出</button></div>
    </article>`).join('')}</div>`
      : all.length ? `<div class="empty-state"><div class="empty-mark">找</div><h2>没有匹配的错词</h2><p>换个关键词试试。</p></div>` : `<div class="empty-state"><div class="empty-mark">净</div><h2>错词本还是空的</h2><p>做题时选错或点“忘记”，词会自动收进来。保持这个状态也很好。</p><a class="btn" href="#/home">回到今日学习</a></div>`}
  </div>`;
}

export function renderStats(app) {
  const s = stats(app.state);
  const maxBar = Math.max(1, ...s.recent.map((item) => item.total));
  const dayLabel = (day) => {
    const date = new Date(`${day}T00:00:00`);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };
  const weekday = ['一', '二', '三', '四', '五', '六', '日'];
  return `<div class="page">
    <div class="page-head"><div><div class="eyebrow">慢慢来，比较快</div><h1>学习统计</h1><p>这里只记和学习有关的事：来了几天、学了多少、还有多少要复习。</p></div><div class="page-actions">${syncChip(app)}</div></div>
    <div class="stats-grid" style="margin-top:0;margin-bottom:18px">
      ${statCard('连续学习', `${s.streak} 天`, `最长 ${s.longestStreak} 天`, 'flame')}
      ${statCard('待复习', s.dueCount, s.overdue ? `${s.overdue} 个已到期` : '暂无逾期', 'clock')}
      ${statCard('已学词', s.learnedCount, `共 ${s.totalWords} 个词`, 'bookMark')}
      ${statCard('已掌握', s.masteredCount, '连续答对会升级', 'target')}
    </div>
    <div class="stats-wide">
      <div>
        <section class="card chart-card">
          <div class="card-head"><div><h2>最近 7 天</h2><p>绿色是新学，金色是复习。</p></div><span class="pill">共 ${s.recent.reduce((sum, item) => sum + item.total, 0)} 次</span></div>
          <div class="bar-chart" role="img" aria-label="最近七天学习次数柱状图">
            ${s.recent.map((item) => `<div class="bar-col"><span class="bar-value">${item.total || ''}</span><div class="bar-stack" style="height:${item.total ? Math.max(6, Math.round((item.total / maxBar) * 100)) : 2}%;width:${Math.max(16, Math.round(100 / Math.max(1, s.recent.length) * .55))}%"><span class="bar-segment" style="height:${item.total ? Math.round((item.newCount / item.total) * 100) : 0}%"></span><span class="bar-segment review" style="height:${item.total ? Math.round((item.reviewCount / item.total) * 100) : 0}%"></span></div><span class="bar-label">${dayLabel(item.date)}</span></div>`).join('')}
          </div>
          <div class="chart-legend"><span><i class="legend-dot"></i>新学</span><span><i class="legend-dot gold"></i>复习</span><span>每天 0 点后重新计算</span></div>
        </section>
        <section class="card chart-card" style="margin-top:14px">
          <div class="card-head"><div><h2>近 28 天</h2><p>有学习记录的日子会亮起来，颜色越深，当天学得越多。</p></div><span class="pill">共 ${s.recent30} 次</span></div>
          <div class="heatmap">
            ${s.thirtyDays.map((item, index) => `<div class="heat ${item.total ? `l${Math.min(4, 1 + Math.floor(item.total / 4))}` : ''} ${item.date === localDay() ? 'today' : ''}" data-date="${attr(item.date)}" title="${formatDateCN(item.date)} · ${item.total ? `学习 ${item.total} 次` : '没有学习'}" aria-label="${formatDateCN(item.date)} ${item.total ? `学习 ${item.total} 次` : '没有学习'}"></div>`).join('')}
          </div>
          <div class="calendar-foot"><span>最近 28 天</span><span>今天 · ${formatDateCN(localDay(), { short: true })}</span></div>
        </section>
      </div>
      <div>
        <section class="card chart-card">
          <div class="ring-row"><div class="big-number">${s.knownRate}<small>%</small></div><div class="ring-copy"><strong>自评“认识”的占比</strong><br>不是考试正确率，只反映你复习时的感觉。</div></div>
          <div class="stat-detail-list">
            <div class="stat-detail"><span>今天已学习</span><strong>${s.today.total} 次</strong></div>
            <div class="stat-detail"><span>今天新学</span><strong>${s.today.newCount} 个</strong></div>
            <div class="stat-detail"><span>今天复习</span><strong>${s.today.reviewCount} 个</strong></div>
            <div class="stat-detail"><span>今天自评忘记</span><strong>${s.today.forgottenCount} 个</strong></div>
          </div>
        </section>
        <section class="card chart-card" style="margin-top:14px">
          <div class="card-head"><div><h2>词库分布</h2><p>成语和实词各有各的难点。</p></div></div>
          <div class="stat-detail-list">
            <div class="stat-detail"><span>成语</span><strong>${s.idiomCount} 个</strong></div>
            <div class="stat-detail"><span>实词</span><strong>${s.wordCount} 个</strong></div>
            <div class="stat-detail"><span>还没学</span><strong>${s.newCount} 个</strong></div>
            <div class="stat-detail"><span>错词本</span><strong>${s.mistakeCount} 个</strong></div>
          </div>
        </section>
      </div>
    </div>
  </div>`;
}

function radioCard(name, value, current, title, desc) {
  return `<label class="radio-card"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''} data-action="setting-radio" data-setting="${name}" data-value="${value}"><strong>${title}</strong><span>${desc}</span></label>`;
}

export function renderSettings(app) {
  const settings = app.state.settings;
  const state = syncLabel(app);
  const local = Boolean(app.localOnly);
  const headNote = local
    ? '这里改的是你自己的计划。所有内容只保存在这台设备的浏览器里，不用登录。'
    : '这里改的是你自己的计划，不会影响别人。改动会马上保存在这台设备，联网后自动保存。';
  const accountCard = local ? `
        <section class="card settings-card">
          <h2>本机数据</h2><p class="card-desc">没有账号，也不需要登录。词库和进度只在这个浏览器里。</p>
          <div class="profile-box"><span class="avatar">${escapeHtml(initials(app.session?.user?.username))}</span><div><strong>${escapeHtml(app.session?.user?.username || '本机词库')}</strong><span>只存在这台设备</span></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>带走我的数据</strong><span>下载一个备份文件，包含词库、学习进度和统计。别人看不到你的词库。</span></div><button class="btn small" data-action="export-data">${icon('download', 14)}下载备份</button></div>
          <div class="setting-row"><div class="setting-copy"><strong>换设备或换浏览器</strong><span>进度不会自动跟过去。可以用备份文件留底，但本静态版不提供导入整份备份的入口。</span></div></div>
        </section>` : `
        <section class="card settings-card">
          <h2>账号</h2><p class="card-desc">只靠用户名和密码区分每个人的词库。</p>
          <div class="profile-box"><span class="avatar">${escapeHtml(initials(app.session?.user?.username))}</span><div><strong>${escapeHtml(app.session?.user?.username || '')}</strong><span>注册于 ${formatDateCN((app.session?.user?.createdAt || '').slice(0, 10), { short: true }) || '今天'}</span></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>修改密码</strong><span>改完以后，其他设备需要重新登录。</span></div><button class="btn small" data-action="change-password">${icon('key', 14)}修改密码</button></div>
          <div class="setting-row"><div class="setting-copy"><strong>带走我的数据</strong><span>下载一个备份文件，包含词库、学习进度和统计，不含密码。</span></div><button class="btn small" data-action="export-data">${icon('download', 14)}下载备份</button></div>
          <div class="setting-row"><div class="setting-copy"><strong>退出登录</strong><span>学习记录会留下；如果还有没送出的学习记录，下次登录同一账号会继续保存。</span></div><button class="btn small danger" data-action="logout">${icon('logOut', 14)}退出</button></div>
        </section>`;
  const storageCard = local ? `
        <section class="card settings-card">
          <h2>本机保存</h2><p class="card-desc">不用手动点保存。每次改动都会自动写进这台浏览器的 IndexedDB。</p>
          <div class="setting-row"><div class="setting-copy"><strong>现在的状态</strong><span>${state.cls === 'offline' ? '这个浏览器没有允许保存，刷新后进度可能留不住。' : '词库和进度只保存在这台浏览器，没有上传到服务器。'}</span></div><span class="sync-chip ${state.cls}" data-sync-chip>${icon(state.icon, 13)}${escapeHtml(state.text)}</span></div>
          <div class="setting-row"><div class="setting-copy"><strong>上次保存</strong><span>${app.sync.lastSuccessAt ? formatDateTimeCN(app.sync.lastSuccessAt) : '还没有在这台设备上保存过'}</span></div><button class="btn small" data-action="manual-sync">立即保存</button></div>
          <div class="about-box"><b>请留意：</b>换手机、换电脑或换浏览器，进度和词库不会自动跟着走。<b>清理浏览器的网站数据也会把词库一起清掉。</b>重要内容请偶尔下载备份。这个静态版不收集账号、不上传词库，也不跨设备同步。</div>
        </section>` : `
        <section class="card settings-card">
          <h2>保存与离线</h2><p class="card-desc">不用手动点保存。学习时先记在这台设备，联网后会送回你的账号。</p>
          <div class="setting-row"><div class="setting-copy"><strong>现在的状态</strong><span>${state.cls === 'offline' ? '没有联网，学习记录先放在这台设备。' : state.cls === 'pending' ? '有记录还没送回你的账号，稍后会自动再试。' : '学习记录已经保存。'}</span></div><span class="sync-chip ${state.cls}" data-sync-chip>${icon(state.icon, 13)}${escapeHtml(state.text)}</span></div>
          <div class="setting-row"><div class="setting-copy"><strong>上次保存成功</strong><span>${app.sync.lastSuccessAt ? formatDateTimeCN(app.sync.lastSuccessAt) : '还没有在这台设备上保存过'}</span></div><button class="btn small" data-action="manual-sync">立即保存</button></div>
          <div class="about-box"><b>离线怎么用：</b>第一次登录并打开过一次后，浏览器会记住页面和你的词库。断网时照样可以学；重新有网，页面会自动把这段时间的记录送回去。换电脑或换浏览器，用同一个用户名和密码登录就能接上。</div>
        </section>`;
  return `<div class="page">
    <div class="page-head"><div><div class="eyebrow">按自己的节奏来</div><h1>设置</h1><p>${headNote}</p></div><div class="page-actions">${local ? syncChip(app) : `<button class="btn small" data-action="manual-sync">${icon('refresh', 14)}立即保存</button>`}</div></div>
    <div class="settings-grid">
      <div>
        <section class="card settings-card">
          <h2>学习计划</h2><p class="card-desc">每天的新学和复习量，都由你决定。</p>
          <div class="setting-row">
            <div class="setting-copy"><strong>每天新学上限</strong><span>默认 20 个。设为 0 就是今天只复习、不学新词。</span></div>
            <div class="setting-control"><label class="number-field"><input class="input" type="number" min="0" max="100" step="1" value="${settings.dailyNewLimit}" data-action="daily-new-limit" aria-label="每天新学上限"><span>个</span></label></div>
          </div>
          <div class="setting-row" style="display:block">
            <div class="setting-copy" style="margin-bottom:10px"><strong>到期复习怎么安排</strong><span>两种方式随时可以换。</span></div>
            <div class="radio-cards">
              ${radioCard('reviewMode', 'clear', settings.reviewMode, '当天清完', '到期的词全部放进今天，不设上限。')}
              ${radioCard('reviewMode', 'flexible', settings.reviewMode, '可以留到后面', '每天最多复习固定数量，剩下的以后再说。')}
            </div>
            ${settings.reviewMode === 'flexible' ? `<div class="setting-row" style="padding-bottom:0"><div class="setting-copy"><strong>每天复习上限</strong><span>留到后面的词仍然算待复习，不会消失。</span></div><div class="setting-control"><label class="number-field"><input class="input" type="number" min="5" max="200" step="5" value="${settings.reviewDailyLimit}" data-action="review-daily-limit" aria-label="每天复习上限"><span>个</span></label></div></div>` : ''}
          </div>
          <div class="setting-row" style="display:block">
            <div class="setting-copy" style="margin-bottom:10px"><strong>默认练习方式</strong><span>只是一种习惯，开始前随时能换。</span></div>
            <div class="radio-cards">
              ${radioCard('practiceMode', 'reveal', settings.practiceMode, '先想再揭晓', '想意思 → 揭晓 → 自评、默写、选近义项。')}
              ${radioCard('practiceMode', 'cloze', settings.practiceMode, '句中选词', '在句子里选词，干扰项会放易混词。')}
            </div>
          </div>
          <div class="setting-row" style="display:block">
            <div class="setting-copy" style="margin-bottom:10px"><strong>默认练习范围</strong><span>成语和实词可以分开，也可以混着来。</span></div>
            <div class="radio-cards" style="grid-template-columns:repeat(3,1fr)">
              ${radioCard('scope', 'all', settings.scope, '混合', '两种一起练')}
              ${radioCard('scope', 'idiom', settings.scope, '只练成语', '专攻成语')}
              ${radioCard('scope', 'word', settings.scope, '只练实词', '专攻实词')}
            </div>
          </div>
        </section>
        ${accountCard}
      </div>
      <div>
        ${storageCard}
        <section class="card settings-card">
          <h2>使用说明</h2><p class="card-desc">都是白话，不用记操作。</p>
          <div class="help-list">
            <div class="help-item"><span class="step-num">1</span><span>每天打开“今日学习”，系统会把到期的旧词和当天的新词排好。</span></div>
            <div class="help-item"><span class="step-num">2</span><span>“先想再揭晓”会看释义、默写、选近义项；“句中选词”直接放进句子里选。</span></div>
            <div class="help-item"><span class="step-num">3</span><span>做错了会自动进错词本；想单独练易混词，就去“易混对比”。</span></div>
            <div class="help-item"><span class="step-num">4</span><span>词库可以导入讲义。只有同一类里字面完全一样的词才算重复，其余照常导入。</span></div>
          </div>
        </section>
        <section class="card settings-card">
          <h2>关于</h2>
          <div class="about-box"><b>言语词库 V1 · GitHub Pages 静态版</b><br>初始词约 60 个：成语 32 个、实词 28 个。选词参考近五年国考、省考和事业单位公开真题中的高频词；例句据公开真题语境改写或编写，不是整套题库原文。<br><br>这是一个独立工具，和“公考错题本”不互通、不共用账号和数据。<br><br>${local ? '所有数据只在你的浏览器里，没有登录、没有服务器数据库，也不跨设备同步。' : ''}<br>不提供“一键清空”，避免误删。重要数据建议偶尔下载备份。</div>
        </section>
      </div>
    </div>
  </div>`;
}

export function renderNotFound(app) {
  return `<div class="page"><div class="empty-state" style="margin-top:8vh"><div class="empty-mark">空</div><h2>这个页面走丢了</h2><p>可能是地址变了，也可能内容已经被移走。</p><a class="btn primary" href="#/home">回到今日学习</a></div></div>`;
}

export function renderRoute(app) {
  const name = app.route.name;
  let content;
  if (name === 'home') content = renderHome(app);
  else if (name === 'words') content = renderWords(app);
  else if (name === 'groups') content = renderGroups(app);
  else if (name === 'group') content = renderGroupDetail(app);
  else if (name === 'mistakes') content = renderMistakes(app);
  else if (name === 'stats') content = renderStats(app);
  else if (name === 'settings') content = renderSettings(app);
  else content = renderNotFound(app);
  return renderShell(app, content);
}

/* ==================== 弹窗 ==================== */

export function renderWordModal(app, word = null) {
  const editing = Boolean(word);
  return `<div class="modal-backdrop" data-action="modal-backdrop">
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="word-modal-title">
      <div class="modal-head"><div><h2 id="word-modal-title">${editing ? '编辑词语' : '添加词语'}</h2><p>${editing ? '改动只影响你自己的词库。' : '填好释义和例句，复习时会用上。'}</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 18)}</button></div>
      <div class="modal-body">
        <form id="word-form" data-id="${attr(word?.id || '')}" novalidate>
          <p class="form-error" id="word-form-error" role="alert"></p>
          <div class="form-grid">
            <div class="field"><label for="w-type">类型</label><select class="select" id="w-type" name="type"><option value="idiom" ${word?.type === 'idiom' ? 'selected' : ''}>成语</option><option value="word" ${word?.type === 'word' ? 'selected' : ''}>实词</option></select></div>
            <div class="field"><label for="w-term">词语</label><input class="input" id="w-term" name="term" maxlength="40" required value="${attr(word?.term || '')}" placeholder="例如：一蹴而就"></div>
            <div class="field full"><label for="w-definition">释义</label><textarea class="textarea" id="w-definition" name="definition" required maxlength="3000" placeholder="用白话写清楚它的意思、使用对象或感情色彩。">${escapeHtml(word?.definition || '')}</textarea></div>
            <div class="field full"><label for="w-example">例句</label><textarea class="textarea" id="w-example" name="example" maxlength="3000" placeholder="最好让词语出现在句子里，句中选词会用这一句。">${escapeHtml(word?.example || '')}</textarea><span class="hint">例句里包含这个词，才能用于“句中选词”。</span></div>
            <div class="field full"><label for="w-source">来源</label><input class="input" id="w-source" name="source" maxlength="300" value="${attr(word?.source || '')}" placeholder="例如：2024 省考真题句改编 / 自编例句"></div>
            <div class="field"><label for="w-near">近义 / 易混词</label><input class="input" id="w-near" name="near" value="${attr((word?.near || []).join('、'))}" placeholder="用顿号分开"><span class="hint">用于“选近义项”检查。</span></div>
            <div class="field"><label for="w-far">干扰词</label><input class="input" id="w-far" name="far" value="${attr((word?.far || []).join('、'))}" placeholder="用顿号分开，可不填"></div>
          </div>
          <div class="modal-footer"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${editing ? '保存修改' : '加入词库'}</button></div>
        </form>
      </div>
    </div>
  </div>`;
}

export function renderWordDetail(app, word) {
  const progress = wordProgress(app.state, word.id);
  const groups = groupsForWord(app.state, word.id);
  const status = !progress.learnedAt ? '新词，还没开始学' : dueText(app, word);
  return `<div class="modal-backdrop" data-action="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="word-detail-title">
      <div class="modal-head"><div><div class="term-line"><h2 id="word-detail-title">${escapeHtml(word.term)}</h2><span class="type-badge ${attr(word.type)}">${TYPE_LABELS[word.type]}</span></div><p>${escapeHtml(status)}</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 18)}</button></div>
      <div class="modal-body">
        <div class="reveal-meaning" style="grid-template-columns:70px 1fr"><span class="reveal-label">释义</span><div class="reveal-def">${escapeHtml(word.definition)}</div></div>
        ${word.example ? `<div class="example-box">${highlightTerm(word.example, word.term)}${word.source ? `<span class="src">${escapeHtml(word.source)}</span>` : ''}</div>` : ''}
        ${word.near?.length ? `<div class="confusable-row"><span>近义 / 易混：</span>${word.near.map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        ${word.far?.length ? `<div class="confusable-row"><span>干扰词：</span>${word.far.map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        ${groups.length ? `<div class="confusable-row"><span>所在易混组：</span>${groups.map((group) => `<a class="mini-chip" href="#/group/${attr(group.id)}" data-action="close-modal-link">${escapeHtml(group.name)}</a>`).join('')}</div>` : ''}
        <div class="modal-footer"><button class="btn ghost" data-action="practice-word" data-id="${attr(word.id)}">${icon('play', 14)}单独练这个词</button><button class="btn primary" data-action="edit-word" data-id="${attr(word.id)}">${icon('edit', 14)}编辑</button></div>
      </div>
    </div>
  </div>`;
}

export function renderGroupModal(app, group = null) {
  const editing = Boolean(group);
  const selected = new Set(group?.wordIds || []);
  const words = activeWords(app.state).sort((a, b) => a.id.localeCompare(b.id, 'zh-CN', { numeric: true }));
  const idioms = words.filter((word) => word.type === 'idiom');
  const realWords = words.filter((word) => word.type === 'word');
  return `<div class="modal-backdrop" data-action="modal-backdrop">
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="group-modal-title">
      <div class="modal-head"><div><h2 id="group-modal-title">${editing ? '编辑易混组' : '新建易混组'}</h2><p>选几个容易混的词，一般 10 个左右。</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 18)}</button></div>
      <div class="modal-body">
        <form id="group-form" data-id="${attr(group?.id || '')}" novalidate>
          <p class="form-error" id="group-form-error" role="alert"></p>
          <div class="field"><label for="g-name">组名</label><input class="input" id="g-name" name="name" maxlength="60" required value="${attr(group?.name || '')}" placeholder="例如：成语 · 容易用错的“意”"></div>
          <div class="field"><label for="g-note">一句话提醒</label><input class="input" id="g-note" name="note" maxlength="500" value="${attr(group?.note || '')}" placeholder="例如：注意适用对象和感情色彩。"></div>
          <div class="field"><label>组里的词 <span class="small muted" id="group-count">已选 ${selected.size} 个</span></label>
            <div class="word-checks">
              ${idioms.length ? `<div class="small muted" style="padding:5px 8px">成语</div>${idioms.map((word) => `<label class="word-check"><input type="checkbox" name="wordIds" value="${attr(word.id)}" ${selected.has(word.id) ? 'checked' : ''} data-action="group-check"><span>${escapeHtml(word.term)}</span><span class="type-badge idiom">成语</span></label>`).join('')}` : ''}
              ${realWords.length ? `<div class="small muted" style="padding:5px 8px">实词</div>${realWords.map((word) => `<label class="word-check"><input type="checkbox" name="wordIds" value="${attr(word.id)}" ${selected.has(word.id) ? 'checked' : ''} data-action="group-check"><span>${escapeHtml(word.term)}</span><span class="type-badge word">实词</span></label>`).join('')}` : ''}
            </div>
          </div>
          <div class="modal-footer"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${editing ? '保存这组' : '建好这组'}</button></div>
        </form>
      </div>
    </div>
  </div>`;
}

export function renderImportModal() {
  return `<div class="modal-backdrop" data-action="modal-backdrop">
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div class="modal-head"><div><h2 id="import-title">导入讲义或词表</h2><p>只导入你自己的词库，不会影响别人。</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 18)}</button></div>
      <div class="modal-body">
        <p class="modal-intro">可以直接选 <b>Excel（.xlsx/.xls）</b>、<b>Word（.docx）</b>、<b>PDF</b>、<b>图片</b>，也可以继续用 CSV/TXT/TSV/JSON 或粘贴。文件只在这台设备的浏览器里读取；图片和扫描件也在本机识字，不上传。先出<b>预览</b>，你确认后才写进词库。</p>
        <div class="import-format">类型,词语,释义,例句,来源,近义,干扰
成语,一蹴而就,踏一步就成功……,关键核心技术不可能一蹴而就。,自编,一步登天,循序渐进
实词,截至,截止到某个时候……,截至10月底……,自编,截止,开始</div>
        <form id="import-form" novalidate>
          <div class="field">
            <label for="import-file">选择文件</label>
            <input class="input" id="import-file" type="file" accept=".csv,.txt,.tsv,.json,.xlsx,.xls,.xlsm,.docx,.pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif,text/csv,text/plain,application/json,application/pdf,image/*">
            <span class="hint">手机上可以直接从相册选图片。旧版 .doc 请先在 Word 里另存为 .docx 或 PDF。</span>
          </div>
          <div class="import-status" id="import-status" role="status" aria-live="polite"></div>
          <div class="field"><label for="import-text">或者粘贴内容</label><textarea class="textarea" id="import-text" name="text" rows="6" placeholder="把词表或讲义内容粘到这里……"></textarea><span class="hint">粘贴后点“生成预览”，确认无误再导入。同一类型里字面完全一样的词会跳过，不会覆盖已有词。</span></div>
          <p class="form-error" id="import-error" role="alert"></p>
          <div id="import-preview" class="import-preview" hidden></div>
          <div class="modal-footer"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" id="import-submit" type="submit">${icon('upload', 15)}生成预览</button></div>
        </form>
        <div id="import-result" class="import-result" hidden></div>
      </div>
    </div>
  </div>`;
}

export function renderPasswordModal() {
  return `<div class="modal-backdrop" data-action="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="password-title">
      <div class="modal-head"><div><h2 id="password-title">修改密码</h2><p>改好后，其他设备需要重新登录。</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 18)}</button></div>
      <div class="modal-body"><form id="password-form" novalidate>
        <p class="form-error" id="password-error" role="alert"></p>
        <div class="field"><label for="old-password">现在的密码</label><input class="input" id="old-password" name="currentPassword" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="new-password">新密码</label><input class="input" id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="6" required><span class="hint">至少 6 位。</span></div>
        <div class="field"><label for="new-password2">再输一遍新密码</label><input class="input" id="new-password2" name="newPassword2" type="password" autocomplete="new-password" required></div>
        <div class="modal-footer"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">改好了</button></div>
      </form></div>
    </div>
  </div>`;
}

export function renderConfirmModal({ title, message, confirmLabel = '确定', cancelLabel = '再想想', danger = false }) {
  return `<div class="modal-backdrop" data-action="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style="max-width:430px">
      <div class="modal-head"><div><h2 id="confirm-title">${escapeHtml(title)}</h2></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 18)}</button></div>
      <div class="modal-body"><p class="small" style="line-height:1.9;color:var(--muted)">${message}</p>
        <div class="modal-footer"><button class="btn ghost" data-action="close-modal">${escapeHtml(cancelLabel)}</button><button class="btn ${danger ? 'cinnabar' : 'primary'}" data-action="confirm-modal">${escapeHtml(confirmLabel)}</button></div>
      </div>
    </div>
  </div>`;
}
