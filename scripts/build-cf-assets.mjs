import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const DIST_DIR = path.join(ROOT, 'dist');

const REQUIRED = [
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/db.js',
  'js/icons.js',
  'js/importer.js',
  'js/import-core.js',
  'js/import-files.js',
  'js/mode.js',
  'js/practice.js',
  'js/util.js',
  'js/views.js',
  'sw.js',
  'manifest.webmanifest',
  '_headers',
  'shared/reducer.mjs',
  'shared/schedule.mjs',
  'shared/selectors.mjs',
  'shared/seed.mjs',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'vendor/README.md',
  'vendor/xlsx/xlsx.mjs',
  'vendor/xlsx/LICENSE',
  'vendor/fflate/fflate.mjs',
  'vendor/fflate/LICENSE',
  'vendor/pdfjs/pdf.min.mjs',
  'vendor/pdfjs/pdf.worker.min.mjs',
  'vendor/pdfjs/LICENSE',
  'vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap',
  'vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap',
  'vendor/pdfjs/standard_fonts/FoxitSerif.pfb',
  'vendor/tesseract/tesseract.esm.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm',
  'vendor/tesseract/lang/chi_sim.traineddata.gz',
  'vendor/tesseract/LICENSE.md',
];

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
  const resolved = path.resolve(DIST_DIR);
  if (path.dirname(resolved) !== ROOT || path.basename(resolved) !== 'dist') {
    throw new Error(`拒绝清理非预期目录：${resolved}`);
  }

  await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });

  // 只复制 public/ 和 shared/。绝不复制 data/、server/、docs/、.git/ 或任何本机数据。
  for (const entry of await readdir(PUBLIC_DIR, { withFileTypes: true })) {
    await cp(
      path.join(PUBLIC_DIR, entry.name),
      path.join(resolved, entry.name),
      { recursive: true },
    );
  }
  await cp(SHARED_DIR, path.join(resolved, 'shared'), { recursive: true });

  const files = await listFiles(resolved);
  for (const required of REQUIRED) {
    if (!files.includes(required)) throw new Error(`部署包缺少文件：${required}`);
  }

  const forbidden = files.filter((file) => (
    file === 'app-data.json'
    || file.startsWith('data/')
    || file.startsWith('backups/')
    || file.endsWith('.tmp')
    || file === '.env'
  ));
  if (forbidden.length) throw new Error(`部署包出现禁止上传的文件：${forbidden.join(', ')}`);

  let bytes = 0;
  for (const file of files) bytes += (await stat(path.join(resolved, file))).size;

  console.log(`Cloudflare 静态资源已构建：dist/`);
  console.log(`文件数：${files.length}，总大小：${(bytes / 1024).toFixed(1)} KB`);
  console.log(`已包含 /shared/*.mjs；未包含 data/ 或 app-data.json。`);
}

main().catch((error) => {
  console.error('构建部署资源失败：', error.message);
  process.exit(1);
});
