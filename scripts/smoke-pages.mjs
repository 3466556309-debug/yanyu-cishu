/**
 * 用本机 Chrome 对 Pages 静态版做一次真实浏览器冒烟测试。
 *
 * 用法：
 *   node scripts/smoke-pages.mjs https://3466556309-debug.github.io/yanyu-cishu/
 *   node scripts/smoke-pages.mjs --dir pages-dist /yanyu-cishu/
 *
 * 检查：不用登录、初始 60 词、能进入练习、完成一个词后写进 IndexedDB、
 * 刷新后学习记录和自定义新词仍在、控制台无异常。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function serveDir(dir, prefix = '/') {
  const root = path.resolve(dir);
  const cleanPrefix = `/${prefix.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (cleanPrefix && pathname === cleanPrefix) {
      res.writeHead(301, { Location: `${cleanPrefix}/` });
      res.end();
      return;
    }
    if (cleanPrefix && !pathname.startsWith(`${cleanPrefix}/`)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    let relative = cleanPrefix ? pathname.slice(cleanPrefix.length + 1) : pathname.slice(1);
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const file = path.join(root, relative);
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      // 项目站 404 回首页；应用本身使用 hash 路由。
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(path.join(root, 'index.html')));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}${cleanPrefix}/` };
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args[0] === '--dir') {
    if (!args[1]) throw new Error('用法：--dir pages-dist /yanyu-cishu/');
    return { dir: args[1], prefix: args[2] || '/' };
  }
  if (!args[0]) throw new Error('用法：node scripts/smoke-pages.mjs <url> 或 --dir pages-dist /yanyu-cishu/');
  return { url: args[0] };
}

async function main() {
  const options = parseArgs();
  let localServer = null;
  let url = options.url;
  if (options.dir) {
    const served = await serveDir(options.dir, options.prefix);
    localServer = served.server;
    url = served.url;
  }

  const profile = await mkdtemp(path.join(os.tmpdir(), 'yanyu-smoke-'));
  const chrome = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-crash-reporter', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], {
    env: { ...process.env, HOME: profile, XDG_CONFIG_HOME: path.join(profile, '.config') },
    stdio: 'ignore',
  });

  const pending = new Map();
  const errors = [];
  let seq = 0;
  let ws;
  let dialogCount = 0;

  function send(method, params = {}) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
    });
  }

  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise, userGesture: true,
    });
    if (result.exceptionDetails) {
      const message = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`页面脚本异常：${message}`);
    }
    return result.result?.value;
  }

  async function waitFor(expression, timeout = 15000, label = expression) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if (await evaluate(expression)) return true; } catch { /* 页面可能正在重绘 */ }
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }

  async function click(selector) {
    const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`找不到可点击元素：${selector}`);
  }

  async function readLocalState() {
    return evaluate(`(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('yanyu-cishu'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const value = await new Promise((resolve, reject) => { const r = db.transaction('kv','readonly').objectStore('kv').get('snapshot:local-user'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const state = value?.state;
      return {
        hasState: !!state,
        active: state ? Object.values(state.words).filter((w) => !w.deletedAt).length : 0,
        custom: state ? Object.values(state.words).some((w) => w.term === '本机测试词') : false,
        checkins: state ? Object.keys(state.checkins || {}).length : 0,
        total: state ? Object.values(state.checkins || {}).reduce((n, c) => n + (c.total || 0), 0) : 0,
        learned: state ? Object.keys(state.progress || {}).length : 0,
      };
    })()`, true);
  }

  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = 0;
    for (let i = 0; i < 100; i += 1) {
      try {
        const text = await readFile(portFile, 'utf8');
        port = Number(text.split('\n')[0]);
        if (port) break;
      } catch { /* 等 Chrome 写端口 */ }
      await sleep(100);
    }
    if (!port) throw new Error('Chrome 没有启动');

    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'exception');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(msg.params.args?.map((a) => a.value ?? a.description).join(' ') || 'console.error');
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push(`${msg.params.entry.source}: ${msg.params.entry.text}`);
      }
      if (msg.method === 'Page.javascriptDialogOpening') {
        dialogCount += 1;
        send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');

    await waitFor("document.readyState === 'complete' && !!document.querySelector('.app-shell')", 20000, '首页加载');
    const initial = await evaluate(`({
      auth: !!document.querySelector('#auth-form'),
      text: document.body.innerText,
      chip: document.querySelector('[data-sync-chip]')?.textContent || '',
      syncClass: document.querySelector('[data-sync-chip]')?.className || ''
    })`);
    if (initial.auth) throw new Error('静态版仍显示登录表单');
    if (!initial.text.includes('开始今日学习')) throw new Error('首页没有“开始今日学习”');
    if (!initial.chip.includes('已存在本机')) throw new Error(`本机保存状态不对：${initial.chip}`);
    if (!initial.syncClass.includes('local')) throw new Error('不是本机模式样式');

    const before = await readLocalState();
    if (!before.hasState || before.active !== 60) throw new Error(`初始词库不对：${JSON.stringify(before)}`);

    const pwa = await evaluate(`(async () => {
      const registration = await navigator.serviceWorker.ready;
      const keys = await caches.keys();
      return { scope: registration.scope, state: registration.active?.state || '', caches: keys };
    })()`, true).catch((error) => ({ error: error.message }));
    if (pwa?.error || pwa?.state !== 'activated' || !pwa.caches?.some((key) => key.startsWith('yanyu-cishu-'))) {
      throw new Error(`Service Worker / PWA 没有就绪：${JSON.stringify(pwa)}`);
    }

    await click('[data-action="start-daily"]');
    await waitFor("!!document.querySelector('#practice-card .prompt-term')", 10000, '进入练习');
    const term = await evaluate("document.querySelector('#practice-card .prompt-term').textContent.trim()");
    if (!term) throw new Error('练习没有显示词语');
    await click('[data-action="reveal"]');
    await waitFor(`!!document.querySelector('[data-action="rate"]')`, 5000, '揭晓');
    await click('[data-action="rate"][data-rating="known"]');
    await evaluate(`(() => { const input = document.querySelector('#dictation-input'); input.value = ${JSON.stringify(term)}; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-action="check-dictation"]').click(); return true; })()`);
    await waitFor("!!document.querySelector('[data-action=\"synonym-choice\"]')", 5000, '近义项');
    await evaluate(`(() => { const b = document.querySelector('[data-action="synonym-choice"]'); if (b) b.click(); return true; })()`);
    await waitFor("!!document.querySelector('#practice-next:not([disabled])')", 5000, '完成三项');
    await click('#practice-next');

    await sleep(400);
    const reviewed = await readLocalState();
    if (!reviewed.checkins || reviewed.total < 1 || reviewed.learned < 1) {
      throw new Error(`学习记录没有写进本机：${JSON.stringify(reviewed)}`);
    }

    await send('Page.reload');
    await waitFor("document.readyState === 'complete' && !!document.querySelector('.app-shell')", 20000, '刷新回首页');
    await evaluate("location.hash = '#/words'");
    await waitFor(`document.body.innerText.includes('我的词库') && !!document.querySelector('[data-action="new-word"]')`, 10000, '词库页');
    await click('[data-action="new-word"]');
    await waitFor("!!document.querySelector('#word-form')", 5000, '添加词弹窗');
    await evaluate(`(() => {
      const set = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('#w-term', '本机测试词');
      set('#w-definition', '这是浏览器本机存储的验收词。');
      set('#w-example', '这个本机测试词只应留在这台浏览器。');
      document.querySelector('#word-form').requestSubmit();
      return true;
    })()`);
    await waitFor("!document.querySelector('#word-form') && document.body.innerText.includes('本机测试词')", 8000, '新词出现在列表');

    await send('Page.reload');
    await waitFor("document.readyState === 'complete' && !!document.querySelector('.app-shell')", 20000, '再次刷新');
    await evaluate("location.hash = '#/words'");
    await waitFor("document.body.innerText.includes('本机测试词')", 10000, '刷新后新词仍在');
    const final = await readLocalState();
    if (final.active !== 61 || !final.custom) throw new Error(`刷新后本机词库不对：${JSON.stringify(final)}`);
    if (errors.length) throw new Error(`控制台有错误：\n${errors.join('\n')}`);

    console.log(JSON.stringify({
      ok: true,
      url,
      initialWords: before.active,
      pwa: { scope: pwa.scope, state: pwa.state, caches: pwa.caches },
      reviewed: { checkins: reviewed.checkins, total: reviewed.total, learned: reviewed.learned },
      final: { active: final.active, custom: final.custom, total: final.total },
      dialogs: dialogCount,
    }, null, 2));
  } finally {
    try { ws?.close(); } catch { /* 忽略 */ }
    chrome.kill('SIGKILL');
    await sleep(300);
    await rm(profile, { recursive: true, force: true });
    if (localServer) await new Promise((resolve) => localServer.close(resolve));
  }
}

main().catch((error) => {
  console.error('冒烟测试失败：', error.message);
  process.exit(1);
});
