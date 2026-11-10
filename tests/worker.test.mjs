import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.mjs';
import { hashPassword, hashToken, verifyPassword } from '../worker/auth.mjs';

let D1Shim;
try {
  ({ D1Shim } = await import('./helpers/d1-shim.mjs'));
} catch (error) {
  // Node 20 没有 node:sqlite；本机服务仍可运行，只是 Worker 测试跳过。
  if (!/node:sqlite/.test(String(error?.message || error))) throw error;
}
const canRunWorkerTests = typeof D1Shim === 'function';
const workerTest = (name, fn) => {
  if (!canRunWorkerTests) {
    test(name, { skip: 'Worker/D1 测试需要 Node 22.5+ 的 node:sqlite' }, () => {});
    return;
  }
  test(name, fn);
};

const ORIGIN = 'https://yanyu-cishu.example.workers.dev';
const migration = await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
const DB = canRunWorkerTests ? new D1Shim() : null;
if (DB) DB.exec(migration);

const assetRequests = [];
const ASSETS = {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    assetRequests.push(pathname);
    if (pathname === '/' || pathname === '/index.html') {
      return new Response('<!doctype html><title>言语词库</title>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    if (pathname === '/shared/reducer.mjs') {
      return new Response('export function applyOps() {}', {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
      });
    }
    if (pathname === '/sw.js') {
      return new Response('self.addEventListener("install", () => {});', {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Service-Worker-Allowed': '/',
        },
      });
    }
    return new Response('not found', { status: 404 });
  },
};

const env = { DB, ASSETS };

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  const init = { method: options.method || 'GET', headers };
  if (options.rawBody !== undefined) init.body = options.rawBody;
  else if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await worker.fetch(new Request(ORIGIN + pathname, init), env);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { status: response.status, headers: response.headers, text, data };
}

function registerBody(username, password = 'password123') {
  return { username, password };
}

workerTest('健康检查与静态资源：API 交给 Worker，其余交给 ASSETS', async () => {
  assetRequests.length = 0;
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(assetRequests.length, 0);
  assert.match(health.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(health.headers.get('cache-control'), 'no-store');

  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /言语词库/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);

  const shared = await request('/shared/reducer.mjs');
  assert.equal(shared.status, 200);
  assert.match(shared.text, /applyOps/);
  assert.match(shared.headers.get('content-type'), /javascript/);

  const sw = await request('/sw.js');
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('service-worker-allowed'), '/');

  const unknown = await request('/api/unknown');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.error, '没有这个服务');

  const wrongMethod = await request('/api/health', { method: 'POST' });
  assert.equal(wrongMethod.status, 404);
});

workerTest('注册：生成独立 60 词词库、PBKDF2 哈希、只存令牌哈希', async () => {
  const username = '甲考生-worker';
  const registered = await request('/api/register', {
    method: 'POST', body: registerBody(username),
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.ok, true);
  assert.match(registered.data.token, /^[A-Za-z0-9_-]{40,50}$/);
  assert.equal(registered.data.user.username, username);
  assert.equal(registered.data.revision, 1);
  assert.equal(Object.keys(registered.data.state.words).length, 60);
  assert.equal(Object.keys(registered.data.state.groups).length, 4);
  assert.ok(registered.data.state.settings);

  const row = DB.db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username);
  assert.match(row.password_hash, /^pbkdf2\$50000\$/);
  assert.doesNotMatch(row.password_hash, /password123/);

  const tokenHash = await hashToken(registered.data.token);
  const session = DB.db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(tokenHash);
  assert.equal(session.token_hash.length, 64);
  assert.notEqual(session.token_hash, registered.data.token);
});

workerTest('注册校验、用户名冲突与错误请求体文案与 Node 版一致', async () => {
  const shortName = await request('/api/register', {
    method: 'POST', body: registerBody('a'),
  });
  assert.equal(shortName.status, 400);
  assert.equal(shortName.data.error, '用户名请填写 2—24 个字');

  const shortPassword = await request('/api/register', {
    method: 'POST', body: { username: '短密码考生', password: '123' },
  });
  assert.equal(shortPassword.status, 400);
  assert.equal(shortPassword.data.error, '密码至少 6 位');

  const first = await request('/api/register', {
    method: 'POST', body: registerBody('CaseUser'),
  });
  assert.equal(first.status, 201);
  const duplicate = await request('/api/register', {
    method: 'POST', body: registerBody('caseuser'),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, '这个用户名已经有人用了，请换一个');

  const badJson = await request('/api/register', {
    method: 'POST', rawBody: '{',
  });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.data.error, '内容格式不正确');

  const arrayJson = await request('/api/register', {
    method: 'POST', rawBody: '[]',
  });
  assert.equal(arrayJson.status, 400);
  assert.equal(arrayJson.data.error, '内容格式不正确');

  const tooLarge = await request('/api/register', {
    method: 'POST', rawBody: JSON.stringify({ username: 'x', password: 'x'.repeat(2 * 1024 * 1024) }),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.data.error, '提交内容太大');
});

workerTest('登录、Bearer 会话、365 天有效期、退出登录', async () => {
  const username = '登录考生';
  const registered = await request('/api/register', {
    method: 'POST', body: registerBody(username),
  });
  assert.equal(registered.status, 201);

  const wrong = await request('/api/login', {
    method: 'POST', body: { username, password: 'wrongpass' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, '用户名或密码不对，请再试一次');

  const login = await request('/api/login', {
    method: 'POST', body: { username, password: 'password123' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.username, username);
  assert.notEqual(login.data.token, registered.data.token);

  const tokenHash = await hashToken(login.data.token);
  const session = DB.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash);
  const days = (Date.parse(session.expires_at) - Date.now()) / 86400000;
  assert.ok(days > 364.9 && days < 365.1, `会话有效期应约 365 天，实际 ${days}`);

  const noToken = await request('/api/sync', {
    method: 'POST', body: { baseRevision: 0, ops: [] },
  });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.data.error, '请先登录');
  assert.equal(noToken.data.code, 'AUTH_REQUIRED');

  const badToken = await request('/api/sync', {
    method: 'POST', token: 'x'.repeat(43), body: { baseRevision: 0, ops: [] },
  });
  assert.equal(badToken.status, 401);
  assert.equal(badToken.data.error, '登录已过期，请重新登录');

  const loggedOut = await request('/api/logout', { method: 'POST', token: login.data.token });
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.data.ok, true);
  const afterLogout = await request('/api/sync', {
    method: 'POST', token: login.data.token, body: { baseRevision: 0, ops: [] },
  });
  assert.equal(afterLogout.status, 401);
});

workerTest('同步：写入、幂等、未修改、用户隔离', async () => {
  const a = await request('/api/register', {
    method: 'POST', body: registerBody('同步甲'),
  });
  const b = await request('/api/register', {
    method: 'POST', body: registerBody('同步乙'),
  });
  const now = new Date().toISOString();
  const op = {
    opId: 'op-sync-a-1',
    at: now,
    type: 'word.upsert',
    payload: {
      id: 'custom-sync-a', type: 'word', term: '甲的词', definition: '只属于甲。', updatedAt: now,
    },
  };

  const first = await request('/api/sync', {
    method: 'POST', token: a.data.token,
    body: { baseRevision: a.data.revision, ops: [op] },
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.notModified, false);
  assert.equal(first.data.applied, 1);
  assert.equal(first.data.revision, 2);
  assert.ok(first.data.state.words['custom-sync-a']);

  const retry = await request('/api/sync', {
    method: 'POST', token: a.data.token,
    body: { baseRevision: first.data.revision, ops: [op] },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.applied, 0);
  assert.equal(retry.data.duplicates, 1);
  assert.equal(retry.data.revision, 2);

  const unchanged = await request('/api/sync', {
    method: 'POST', token: a.data.token,
    body: { baseRevision: 2, ops: [] },
  });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.data.notModified, true);
  assert.equal('state' in unchanged.data, false);

  const stale = await request('/api/sync', {
    method: 'POST', token: a.data.token,
    body: { baseRevision: 0, ops: [] },
  });
  assert.equal(stale.status, 200);
  assert.equal(stale.data.notModified, false);
  assert.equal(stale.data.revision, 2);
  assert.ok(stale.data.state.words['custom-sync-a']);

  const bSync = await request('/api/sync', {
    method: 'POST', token: b.data.token,
    body: { baseRevision: b.data.revision, ops: [] },
  });
  assert.equal(bSync.status, 200);
  assert.equal(bSync.data.notModified, true);
  assert.equal(Object.keys(bSync.data.state || {}).length, 0);

  const bLogin = await request('/api/login', {
    method: 'POST', body: { username: '同步乙', password: 'password123' },
  });
  assert.equal(Object.keys(bLogin.data.state.words).length, 60);
  assert.equal(bLogin.data.state.words['custom-sync-a'], undefined);

  const aLogin = await request('/api/login', {
    method: 'POST', body: { username: '同步甲', password: 'password123' },
  });
  assert.ok(aLogin.data.state.words['custom-sync-a']);
});

workerTest('同步：服务端拦截同类型同字面冲突，其余词照常写入', async () => {
  const registered = await request('/api/register', {
    method: 'POST', body: registerBody('冲突考生-worker'),
  });
  const now = new Date().toISOString();
  const ops = [
    {
      opId: 'op-conflict-1', at: now, type: 'word.upsert',
      payload: { id: 'dup-worker-1', type: 'word', term: '截至', definition: '重复', updatedAt: now },
    },
    {
      opId: 'op-conflict-2', at: now, type: 'word.upsert',
      payload: { id: 'dup-worker-2', type: 'word', term: '甄别', definition: '仔细辨别。', updatedAt: now },
    },
  ];
  const result = await request('/api/sync', {
    method: 'POST', token: registered.data.token,
    body: { baseRevision: registered.data.revision, ops },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.applied, 1);
  assert.equal(result.data.skipped.length, 1);
  assert.match(result.data.skipped[0].reason, /已存在/);
  assert.ok(result.data.state.words['dup-worker-2']);
  assert.equal(result.data.state.words['dup-worker-1'], undefined);
});

workerTest('同步：两台设备同时写不会互相覆盖', async () => {
  const registered = await request('/api/register', {
    method: 'POST', body: registerBody('并发考生'),
  });
  const now = new Date().toISOString();
  const makeOp = (id, term) => ({
    opId: `op-concurrent-${id}`,
    at: now,
    type: 'word.upsert',
    payload: { id: `custom-${id}`, type: 'word', term, definition: `${term}的释义。`, updatedAt: now },
  });
  const [left, right] = await Promise.all([
    request('/api/sync', {
      method: 'POST', token: registered.data.token,
      body: { baseRevision: 1, ops: [makeOp('left', '左词')] },
    }),
    request('/api/sync', {
      method: 'POST', token: registered.data.token,
      body: { baseRevision: 1, ops: [makeOp('right', '右词')] },
    }),
  ]);
  assert.equal(left.status, 200);
  assert.equal(right.status, 200);
  assert.ok(left.data.revision >= 2);
  assert.ok(right.data.revision >= 2);

  const login = await request('/api/login', {
    method: 'POST', body: { username: '并发考生', password: 'password123' },
  });
  assert.ok(login.data.state.words['custom-left']);
  assert.ok(login.data.state.words['custom-right']);
  assert.equal(login.data.revision, 3);
});

workerTest('修改密码：旧密码失效、当前会话保留、其他会话失效', async () => {
  const username = '改密考生-worker';
  const registered = await request('/api/register', {
    method: 'POST', body: registerBody(username),
  });
  const secondLogin = await request('/api/login', {
    method: 'POST', body: { username, password: 'password123' },
  });
  const currentToken = secondLogin.data.token;

  const wrongCurrent = await request('/api/password', {
    method: 'POST', token: currentToken,
    body: { currentPassword: 'not-the-password', newPassword: 'newpassword456' },
  });
  assert.equal(wrongCurrent.status, 400);
  assert.equal(wrongCurrent.data.error, '现在的密码不对');

  const changed = await request('/api/password', {
    method: 'POST', token: currentToken,
    body: { currentPassword: 'password123', newPassword: 'newpassword456' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.message, '密码已经改好');

  const oldPassword = await request('/api/login', {
    method: 'POST', body: { username, password: 'password123' },
  });
  assert.equal(oldPassword.status, 401);

  const newPassword = await request('/api/login', {
    method: 'POST', body: { username, password: 'newpassword456' },
  });
  assert.equal(newPassword.status, 200);

  const currentStillWorks = await request('/api/sync', {
    method: 'POST', token: currentToken, body: { baseRevision: 0, ops: [] },
  });
  assert.equal(currentStillWorks.status, 200);

  const otherSession = await request('/api/sync', {
    method: 'POST', token: registered.data.token, body: { baseRevision: 0, ops: [] },
  });
  assert.equal(otherSession.status, 401);
});

workerTest('过期会话会失效并从会话表清掉', async () => {
  const username = '过期考生';
  const registered = await request('/api/register', {
    method: 'POST', body: registerBody(username),
  });
  const tokenHash = await hashToken(registered.data.token);
  DB.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
    .run('2020-01-01T00:00:00.000Z', tokenHash);

  const expired = await request('/api/sync', {
    method: 'POST', token: registered.data.token, body: { baseRevision: 0, ops: [] },
  });
  assert.equal(expired.status, 401);
  const row = DB.db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(tokenHash);
  assert.equal(row, undefined);
});

workerTest('同步参数校验文案与 Node 版一致', async () => {
  const registered = await request('/api/register', {
    method: 'POST', body: registerBody('校验考生'),
  });
  const token = registered.data.token;

  const notArray = await request('/api/sync', {
    method: 'POST', token, body: { baseRevision: 1, ops: 'nope' },
  });
  assert.equal(notArray.status, 400);
  assert.equal(notArray.data.error, '学习记录格式不正确');

  const badId = await request('/api/sync', {
    method: 'POST', token,
    body: { baseRevision: 1, ops: [{ opId: 'x', at: new Date().toISOString(), type: 'word.upsert', payload: {} }] },
  });
  assert.equal(badId.status, 400);
  assert.equal(badId.data.error, '学习记录编号不正确');

  const badType = await request('/api/sync', {
    method: 'POST', token,
    body: {
      baseRevision: 1,
      ops: [{ opId: 'op-bad-type', at: new Date().toISOString(), type: 'unknown.op', payload: {} }],
    },
  });
  assert.equal(badType.status, 400);
  assert.equal(badType.data.error, '学习记录类型不正确');

  const badTime = await request('/api/sync', {
    method: 'POST', token,
    body: {
      baseRevision: 1,
      ops: [{ opId: 'op-bad-time', at: 'not-a-date', type: 'word.upsert', payload: {} }],
    },
  });
  assert.equal(badTime.status, 400);
  assert.equal(badTime.data.error, '学习记录时间不正确');

  const badPayload = await request('/api/sync', {
    method: 'POST', token,
    body: {
      baseRevision: 1,
      ops: [{ opId: 'op-bad-payload', at: new Date().toISOString(), type: 'word.upsert', payload: [] }],
    },
  });
  assert.equal(badPayload.status, 400);
  assert.equal(badPayload.data.error, '学习记录内容不正确');
});

workerTest('PBKDF2 哈希可验证、盐每次不同、错误密码不通过', async () => {
  const first = await hashPassword('password123');
  const second = await hashPassword('password123');
  assert.match(first, /^pbkdf2\$50000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('password123', first), true);
  assert.equal(await verifyPassword('wrongpass', first), false);
  assert.equal(await verifyPassword('password123', `${first.slice(0, -2)}00`), false);
  assert.equal(await verifyPassword('password123', 'scrypt$16384$8$1$abc$def'), false);
  assert.equal(await verifyPassword('password123', 'pbkdf2$999999$00$00'), false);
});
