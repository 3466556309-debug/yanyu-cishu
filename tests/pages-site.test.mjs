import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { applyOp } from '../shared/reducer.mjs';
import { createSeedState } from '../shared/seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

test('GitHub Pages 构建：本机模式、相对路径、无本机数据', async () => {
  await run(process.execPath, ['scripts/build-pages.mjs'], { cwd: ROOT });
  const out = path.join(ROOT, 'pages-dist');

  const mode = await readFile(path.join(out, 'js', 'mode.js'), 'utf8');
  assert.match(mode, /export const APP_MODE = 'local'/);
  assert.match(mode, /export const IS_LOCAL_ONLY = true/);

  const index = await readFile(path.join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(index, /(?:src|href)="\//, '项目站不能有根路径绝对资源');
  assert.match(index, /src="\.\/js\/app\.js"/);
  assert.match(index, /href="\.\/css\/app\.css"/);

  const app = await readFile(path.join(out, 'js', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /from '\/shared\//, 'app.js 必须用相对路径引用 shared');
  assert.match(app, /from '\.\.\/shared\/reducer\.mjs'/);
  assert.match(app, /IS_LOCAL_ONLY/);

  const manifest = JSON.parse(await readFile(path.join(out, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');

  await assert.rejects(stat(path.join(out, 'data', 'app-data.json')));
  await assert.rejects(stat(path.join(out, 'server')));
  await assert.rejects(stat(path.join(out, 'worker')));
  await assert.rejects(stat(path.join(out, 'migrations')));
  assert.ok((await stat(path.join(out, '.nojekyll'))).isFile());
});

test('Pages 应用外壳和模块导入在项目站前缀下都找得到', async () => {
  const out = path.join(ROOT, 'pages-dist');
  const sw = await readFile(path.join(out, 'sw.js'), 'utf8');
  const shell = [...sw.matchAll(/'\.\/([^']*)'/g)]
    .map((match) => match[1])
    .filter(Boolean);
  assert.ok(shell.length >= 15, 'Service Worker 应用外壳文件太少');
  for (const relative of shell) {
    const file = path.join(out, relative);
    assert.ok((await stat(file)).isFile(), `缓存清单缺少文件：${relative}`);
  }

  for (const name of ['app.js', 'views.js', 'practice.js']) {
    const source = await readFile(path.join(out, 'js', name), 'utf8');
    const imports = [...source.matchAll(/from '(\.[^']+)'/g)].map((match) => match[1]);
    for (const specifier of imports) {
      const file = path.resolve(path.join(out, 'js'), specifier);
      assert.ok((await stat(file)).isFile(), `${name} 的导入在 Pages 包里不存在：${specifier}`);
    }
  }
});

test('静态本机模式的初始词库与学习记录可序列化保存、重新读取', () => {
  const state = createSeedState('2026-11-10T08:00:00.000Z');
  assert.equal(Object.keys(state.words).length, 60);
  assert.equal(Object.keys(state.groups).length, 4);

  const reviewed = applyOp(state, {
    opId: 'review-1',
    at: '2026-11-10T09:00:00.000Z',
    type: 'review.record',
    payload: {
      wordId: 'seed-idiom-01',
      rating: 'known',
      mode: 'reveal',
      dictation: 'correct',
      synonym: 'correct',
      day: '2026-11-10',
    },
  });
  assert.equal(reviewed.applied, true);

  const snapshot = {
    state: reviewed.state,
    revision: 2,
    cachedAt: '2026-11-10T09:00:01.000Z',
  };
  const reloaded = JSON.parse(JSON.stringify(snapshot));
  assert.equal(Object.values(reloaded.state.words).filter((word) => !word.deletedAt).length, 60);
  assert.equal(reloaded.state.checkins['2026-11-10'].total, 1);
  assert.ok(reloaded.state.progress['seed-idiom-01'].learnedAt);
  assert.equal(reloaded.revision, 2);
});
