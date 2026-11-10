#!/usr/bin/env node
/**
 * 免费档发布脚本（由已登录的布置方执行）。
 *
 * 它只做这些事：
 *   1. 构建静态资源（public + shared -> dist，不包含 data/）
 *   2. 确认本机 wrangler 已登录（绝不代替你 wrangler login）
 *   3. 查找/创建免费 D1 数据库 yanyu-cishu，并把 database_id 写回 wrangler.toml
 *   4. 对远程 D1 应用 migrations/
 *   5. wrangler deploy 到 workers.dev
 *
 * 不购买域名、不升级套餐、不绑卡。若遇到需要付费或需要额外授权的提示，
 * 脚本会失败退出，不会自动升级。
 */
import { spawnSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'wrangler.toml');
const WRANGLER = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
const DB_NAME = 'yanyu-cishu';
const PLACEHOLDER_IDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'REPLACE_WITH_D1_DATABASE_ID',
]);

function log(message) {
  console.log(`\n[cf-release] ${message}`);
}

function fail(message, code = 1) {
  console.error(`\n[cf-release] 已停止：${message}`);
  process.exit(code);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function run(args, options = {}) {
  const result = spawnSync(WRANGLER, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function extractJson(text, opener, closer) {
  const start = text.indexOf(opener);
  const end = text.lastIndexOf(closer);
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findUuid(text) {
  const explicit = /database_id\s*=\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i.exec(text);
  if (explicit) return explicit[1];
  const match = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text);
  return match ? match[0] : '';
}

async function build() {
  log('构建静态资源：dist/（只包含 public/ 与 shared/）');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-cf-assets.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) fail('静态资源构建失败');
}

async function readConfig() {
  const text = await readFile(CONFIG, 'utf8');
  const match = /^\s*database_id\s*=\s*"([^"]*)"/m.exec(text);
  if (!match) fail('wrangler.toml 里找不到 database_id');
  return { text, databaseId: match[1] };
}

function checkConfigShape(text) {
  const required = [
    'name = "yanyu-cishu"',
    'main = "worker/index.mjs"',
    'directory = "./dist"',
    'binding = "DB"',
    'database_name = "yanyu-cishu"',
    'migrations_dir = "migrations"',
  ];
  for (const item of required) {
    if (!text.includes(item)) fail(`wrangler.toml 缺少配置：${item}`);
  }
  if (/durable_objects|r2_buckets|routes\s*=|custom_domain/.test(text)) {
    fail('wrangler.toml 出现了付费/自定义域名相关配置，请人工检查');
  }
}

function whoami() {
  const result = run(['whoami'], { capture: true });
  const output = `${result.stdout}\n${result.stderr}`;
  if (/not authenticated|not logged in|please run `wrangler login`/i.test(output)) {
    fail('本机 wrangler 还没有登录。请由已授权的免费账号执行 `npx wrangler login` 后重跑；本脚本不会代替你登录。');
  }
  if (result.status !== 0) {
    fail(`无法确认 Cloudflare 登录态：${output.trim().slice(-800)}`);
  }
  process.stdout.write(output);
}

async function listDatabases() {
  const result = run(['d1', 'list', '--json'], { capture: true });
  if (result.status !== 0) {
    const details = `${result.stdout}\n${result.stderr}`.trim().slice(-1200);
    fail(`读取 D1 列表失败：${details}`);
  }
  const payload = extractJson(result.stdout, '[', ']');
  const parsed = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.result) ? payload.result : null);
  if (!Array.isArray(parsed)) fail('无法解析 `wrangler d1 list --json` 的输出；请手动创建 D1 后重试。');
  return parsed;
}

async function createDatabase() {
  log(`没有找到 D1 数据库 ${DB_NAME}，创建一个免费 D1`);
  const result = run(['d1', 'create', DB_NAME, '--location', 'apac'], { capture: true });
  const output = `${result.stdout}\n${result.stderr}`;
  process.stdout.write(output);
  if (result.status !== 0) {
    fail('创建 D1 失败。免费账号最多 10 个 D1；如果提示额度/权限问题，请勿升级套餐，改由人工处理。');
  }
  const uuid = findUuid(result.stdout) || findUuid(result.stderr);
  if (!uuid) fail('D1 命令成功但没解析到 database_id，请手动把输出里的 uuid 填入 wrangler.toml。');
  return uuid;
}

async function ensureDatabaseId(text, databaseId) {
  if (!PLACEHOLDER_IDS.has(databaseId)) {
    log(`使用 wrangler.toml 中已有的 D1 database_id：${databaseId}`);
    return databaseId;
  }

  const databases = await listDatabases();
  const existing = databases.find((item) => item.name === DB_NAME || item.database_name === DB_NAME);
  let uuid = existing?.uuid || existing?.database_id || existing?.id || '';
  if (uuid) {
    log(`找到已有 D1 数据库：${DB_NAME}（${uuid}）`);
  } else {
    uuid = await createDatabase();
  }

  const next = text.replace(/^(\s*database_id\s*=\s*")[^"]*(")/m, `$1${uuid}$2`);
  if (next === text) fail('无法把 database_id 写回 wrangler.toml，请手动填写。');
  await writeFile(CONFIG, next, 'utf8');
  log(`已把数据库 ID 写入 wrangler.toml：${uuid}`);
  return uuid;
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  if (!await exists(WRANGLER)) {
    fail('没有安装 wrangler。请先运行 `npm install`（wrangler 在 devDependencies 中，不需要登录）。');
  }
  await build();

  const config = await readConfig();
  checkConfigShape(config.text);

  if (checkOnly) {
    log('配置与静态资源检查通过（--check，不联网、不登录、不发布）。');
    return;
  }

  whoami();
  const databaseId = await ensureDatabaseId(config.text, config.databaseId);
  log(`准备使用 D1：${DB_NAME} / ${databaseId}`);

  log('对远程 D1 应用 migrations/');
  const migrate = run(['d1', 'migrations', 'apply', DB_NAME, '--remote'], {
    env: { CI: '1' },
  });
  if (migrate.status !== 0) {
    fail('D1 迁移失败。请检查免费额度与权限；不要通过升级付费套餐解决，先记录下来交给文轩决定。');
  }

  log('发布 Worker 到 free workers.dev');
  const deploy = run(['deploy']);
  if (deploy.status !== 0) {
    fail('wrangler deploy 失败。请保留上面的错误输出；不要开启付费功能。');
  }

  log('发布命令完成。预期地址形态：https://yanyu-cishu.<你的 workers.dev 子域>.workers.dev/');
  log('请打开该地址做一次健康检查：GET /api/health 应返回 {"ok":true,...}。');
}

main().catch((error) => fail(error.stack || error.message));
