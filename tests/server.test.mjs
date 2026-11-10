import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/server.mjs';

let server;
let base;
let tempDir;

async function request(pathname, options = {}) {
  const response = await fetch(base + pathname, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, headers: response.headers };
}

test.before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'yanyu-test-'));
  const app = await createApp({ dataFile: path.join(tempDir, 'app-data.json') });
  server = app.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
});

test('注册后得到独立的 60 词个人词库，错误密码不能登录', async () => {
  const reg = await request('api/register', { method: 'POST', body: { username: '甲考生', password: 'password123' } });
  assert.equal(reg.status, 201);
  assert.equal(Object.keys(reg.data.state.words).length, 60);
  assert.equal(Object.keys(reg.data.state.groups).length, 4);
  assert.match(reg.headers.get('content-security-policy'), /script-src 'self'/);

  const bad = await request('api/login', { method: 'POST', body: { username: '甲考生', password: 'wrongpass' } });
  assert.equal(bad.status, 401);

  const ok = await request('api/login', { method: 'POST', body: { username: '甲考生', password: 'password123' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.username, '甲考生');
});

test('账号之间词库与进度互不影响', async () => {
  const a = await request('api/register', { method: 'POST', body: { username: '隔离甲', password: 'password123' } });
  const b = await request('api/register', { method: 'POST', body: { username: '隔离乙', password: 'password123' } });
  const op = {
    opId: 'op-isolation-1', at: new Date().toISOString(), type: 'word.upsert',
    payload: {
      id: 'custom-isolation', type: 'word', term: '甲的词', definition: '只属于甲。',
      updatedAt: new Date().toISOString(),
    },
  };
  const synced = await request('api/sync', { method: 'POST', token: a.data.token, body: { baseRevision: a.data.revision, ops: [op] } });
  assert.equal(synced.status, 200);
  assert.ok(synced.data.state.words['custom-isolation']);
  const bSync = await request('api/sync', { method: 'POST', token: b.data.token, body: { baseRevision: b.data.revision, ops: [] } });
  assert.equal(bSync.status, 200);
  assert.equal(bSync.data.notModified, true);
  const bLogin = await request('api/login', { method: 'POST', body: { username: '隔离乙', password: 'password123' } });
  assert.equal(Object.keys(bLogin.data.state.words).length, 60);
});

test('复习记录可跨设备同步，重复提交不会重复计数', async () => {
  const reg = await request('api/register', { method: 'POST', body: { username: '同步考生', password: 'password123' } });
  const op = {
    opId: 'op-review-sync-1', at: new Date().toISOString(), type: 'review.record',
    payload: { wordId: 'seed-idiom-01', rating: 'known', day: '2026-11-10', mode: 'reveal' },
  };
  const first = await request('api/sync', { method: 'POST', token: reg.data.token, body: { baseRevision: reg.data.revision, ops: [op] } });
  assert.equal(first.status, 200);
  assert.equal(first.data.state.checkins['2026-11-10'].total, 1);
  const retry = await request('api/sync', { method: 'POST', token: reg.data.token, body: { baseRevision: first.data.revision, ops: [op] } });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.duplicates, 1);
  assert.equal(retry.data.state.checkins['2026-11-10'].total, 1);

  const login2 = await request('api/login', { method: 'POST', body: { username: '同步考生', password: 'password123' } });
  assert.equal(login2.data.state.progress['seed-idiom-01'].lastRating, 'known');
  assert.equal(login2.data.state.checkins['2026-11-10'].total, 1);
});

test('服务端会拦住完全同名的同类词，但导入其余词照常', async () => {
  const reg = await request('api/register', { method: 'POST', body: { username: '冲突考生', password: 'password123' } });
  const now = new Date().toISOString();
  const ops = [
    { opId: 'op-dup-1', at: now, type: 'word.upsert', payload: { id: 'dup-1', type: 'word', term: '截至', definition: '重复', updatedAt: now } },
    { opId: 'op-dup-2', at: now, type: 'word.upsert', payload: { id: 'dup-2', type: 'idiom', term: '按图索骥', definition: '按线索寻找。', updatedAt: now } },
  ];
  const result = await request('api/sync', { method: 'POST', token: reg.data.token, body: { baseRevision: reg.data.revision, ops } });
  assert.equal(result.status, 200);
  assert.equal(result.data.applied, 1);
  assert.equal(result.data.skipped.length, 1);
  assert.ok(result.data.state.words['dup-2']);
  assert.equal(result.data.state.words['dup-1'], undefined);
});

test('修改密码后旧密码失效，当前设备仍然可用', async () => {
  const reg = await request('api/register', { method: 'POST', body: { username: '改密考生', password: 'password123' } });
  const changed = await request('api/password', {
    method: 'POST', token: reg.data.token,
    body: { currentPassword: 'password123', newPassword: 'newpassword456' },
  });
  assert.equal(changed.status, 200);
  const old = await request('api/login', { method: 'POST', body: { username: '改密考生', password: 'password123' } });
  assert.equal(old.status, 401);
  const fresh = await request('api/login', { method: 'POST', body: { username: '改密考生', password: 'newpassword456' } });
  assert.equal(fresh.status, 200);
  const current = await request('api/sync', { method: 'POST', token: reg.data.token, body: { baseRevision: 0, ops: [] } });
  assert.equal(current.status, 200);
});

test('数据文件落盘且不保存明文密码', async () => {
  const raw = await readFile(path.join(tempDir, 'app-data.json'), 'utf8');
  assert.doesNotMatch(raw, /password123/);
  assert.match(raw, /scrypt\$/);
});
