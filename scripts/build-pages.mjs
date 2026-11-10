import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const OUT_DIR = path.join(ROOT, 'pages-dist');

const REQUIRED = [
  'index.html',
  '404.html',
  '.nojekyll',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/db.js',
  'js/icons.js',
  'js/importer.js',
  'js/mode.js',
  'js/practice.js',
  'js/util.js',
  'js/views.js',
  'sw.js',
  'manifest.webmanifest',
  'shared/reducer.mjs',
  'shared/schedule.mjs',
  'shared/selectors.mjs',
  'shared/seed.mjs',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

const LOCAL_MODE = `/**
 * GitHub Pages 构建产物：静态本机模式。
 * 不登录、不请求接口，词库和进度只保存在当前浏览器。
 */
export const APP_MODE = 'local';
export const IS_LOCAL_ONLY = true;
`;

async function listFiles(dir, prefix = '') {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await listFiles(path.join(dir, entry.name), relative));
    else output.push(relative);
  }
  return output;
}

async function main() {
  const resolved = path.resolve(OUT_DIR);
  if (path.dirname(resolved) !== ROOT || path.basename(resolved) !== 'pages-dist') {
    throw new Error(`拒绝清理非预期目录：${resolved}`);
  }

  await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });

  // 只复制 public/ 和 shared/。绝不复制 data/、server/、worker/、.git/ 或本机数据。
  for (const entry of await readdir(PUBLIC_DIR, { withFileTypes: true })) {
    if (entry.name === '_headers') continue; // GitHub Pages 不支持 _headers
    await cp(path.join(PUBLIC_DIR, entry.name), path.join(resolved, entry.name), { recursive: true });
  }
  await cp(SHARED_DIR, path.join(resolved, 'shared'), { recursive: true });

  // 把运行模式改成静态本机版；源码仍保持 server，避免影响 Node / Cloudflare。
  await writeFile(path.join(resolved, 'js', 'mode.js'), LOCAL_MODE, 'utf8');
  // 关掉 GitHub Pages 的 Jekyll 处理，避免下划线文件与缓存问题。
  await writeFile(path.join(resolved, '.nojekyll'), '', 'utf8');
  // 项目站 404 也回首页；应用本身用 hash 路由。
  await cp(path.join(resolved, 'index.html'), path.join(resolved, '404.html'));

  const files = await listFiles(resolved);
  for (const required of REQUIRED) {
    if (!files.includes(required)) throw new Error(`Pages 部署包缺少文件：${required}`);
  }

  const forbidden = files.filter((file) => (
    file === 'app-data.json'
    || file.startsWith('data/')
    || file.startsWith('backups/')
    || file.endsWith('.tmp')
    || file === '.env'
    || file.startsWith('server/')
    || file.startsWith('worker/')
    || file.startsWith('migrations/')
  ));
  if (forbidden.length) throw new Error(`Pages 部署包出现禁止上传的文件：${forbidden.join(', ')}`);

  const appJs = await readFile(path.join(resolved, 'js', 'app.js'), 'utf8');
  const modeJs = await readFile(path.join(resolved, 'js', 'mode.js'), 'utf8');
  if (!/export const IS_LOCAL_ONLY = true;/.test(modeJs)) throw new Error('Pages 模式没有切到本机模式');
  if (appJs.includes("from '/shared/")) throw new Error('app.js 仍在使用根路径 /shared 导入，项目站会 404');
  if (appJs.includes('createSeedState')) {
    if (!files.includes('shared/seed.mjs')) throw new Error('缺少初始词库 shared/seed.mjs');
  }

  const indexHtml = await readFile(path.join(resolved, 'index.html'), 'utf8');
  if (/(?:src|href)="\//.test(indexHtml)) throw new Error('index.html 仍含根路径绝对资源，项目站会 404');

  const manifest = JSON.parse(await readFile(path.join(resolved, 'manifest.webmanifest'), 'utf8'));
  if (manifest.start_url !== './' || manifest.scope !== './') throw new Error('manifest 的 start_url/scope 不是相对路径');
  for (const item of manifest.icons || []) {
    if (String(item.src).startsWith('/')) throw new Error('manifest 图标仍是根路径');
  }

  let bytes = 0;
  for (const file of files) bytes += (await stat(path.join(resolved, file))).size;

  console.log('GitHub Pages 静态站点已构建：pages-dist/');
  console.log(`文件数：${files.length}，总大小：${(bytes / 1024).toFixed(1)} KB`);
  console.log('模式：本机词库（IndexedDB），无登录、无后台接口。');
  console.log('未包含 data/、server/、worker/、migrations/ 或 app-data.json。');
}

main().catch((error) => {
  console.error('构建 Pages 资源失败：', error.message);
  process.exit(1);
});
