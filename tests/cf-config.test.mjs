import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('wrangler 配置只使用免费 Workers + D1 + workers.dev', async () => {
  const config = await readFile(path.join(ROOT, 'wrangler.toml'), 'utf8');
  assert.match(config, /^name = "yanyu-cishu"$/m);
  assert.match(config, /^main = "worker\/index\.mjs"$/m);
  assert.match(config, /^workers_dev = true$/m);
  assert.match(config, /^\[assets\]$/m);
  assert.match(config, /^directory = "\.\/dist"$/m);
  assert.match(config, /^run_worker_first = \["\/api\/\*"\]$/m);
  assert.match(config, /^\[\[d1_databases\]\]$/m);
  assert.match(config, /^binding = "DB"$/m);
  assert.match(config, /^database_name = "yanyu-cishu"$/m);

  // 不能出现付费/额外付费资源或自定义域名绑定。
  assert.doesNotMatch(config, /durable_objects|r2_buckets|queues|vectorize|hyperdrive|analytics_engine/i);
  assert.doesNotMatch(config, /^routes\s*=|custom_domain|zone_id/m);
});

test('D1 迁移只建用户/会话表，线上从空库开始', async () => {
  const sql = await readFile(path.join(ROOT, 'migrations', '0001_init.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(sql, /norm_username\s+TEXT NOT NULL UNIQUE/);
  assert.match(sql, /state_json\s+TEXT NOT NULL/);
  assert.match(sql, /token_hash\s+TEXT PRIMARY KEY/);
  // 不能包含任何用户数据或本机数据导入语句。
  assert.doesNotMatch(sql, /INSERT INTO|app-data|password123|本机/);
});

test('静态响应头包含 CSP，Service Worker 不被缓存', async () => {
  const headers = await readFile(path.join(ROOT, 'public', '_headers'), 'utf8');
  assert.match(headers, /Content-Security-Policy:.*script-src 'self'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /\/sw\.js[\s\S]*Cache-Control: no-cache/);
  assert.match(headers, /Service-Worker-Allowed: \//);
});

test('发布脚本只调用免费档命令，不包含 login/token 自动操作', async () => {
  const script = await readFile(path.join(ROOT, 'scripts', 'cf-release.mjs'), 'utf8');
  assert.match(script, /'deploy'/);
  assert.match(script, /'d1', 'create'/);
  assert.match(script, /migrations', 'apply'/);
  assert.doesNotMatch(script, /wrangler', 'login'|CLOUDFLARE_API_TOKEN\s*=/);
  assert.doesNotMatch(script, /pages deploy|publish|paid|billing/i);
});
