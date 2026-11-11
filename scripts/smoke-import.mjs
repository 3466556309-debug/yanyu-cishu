/**
 * 真实浏览器冒烟：从 Excel / Word / PDF / 图片 导入并预览确认写入。
 *
 * 用法：
 *   node scripts/smoke-import.mjs --dir pages-dist /yanyu-cishu/
 *   node scripts/smoke-import.mjs https://3466556309-debug.github.io/yanyu-cishu/
 *
 * 图片识字第一次会下载识别部件，可能要等 1~2 分钟。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'import');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' data:; manifest-src 'self'; worker-src 'self'";
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
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
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': CSP,
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
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
  if (!args[0]) throw new Error('用法：node scripts/smoke-import.mjs <url> 或 --dir pages-dist /yanyu-cishu/');
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

  const profile = await mkdtemp(path.join(os.tmpdir(), 'yanyu-import-smoke-'));
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

  function send(method, params = {}) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 30000);
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

  async function waitFor(expression, timeout = 20000, label = expression) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if (await evaluate(expression)) return true; } catch { /* 页面可能正在重绘 */ }
      await sleep(150);
    }
    throw new Error(`等待超时：${label}`);
  }

  async function readLocalState() {
    return evaluate(`(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('yanyu-cishu'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const value = await new Promise((resolve, reject) => { const r = db.transaction('kv','readonly').objectStore('kv').get('snapshot:local-user'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const state = value?.state;
      const words = state ? Object.values(state.words).filter((w) => !w.deletedAt) : [];
      return { active: words.length, terms: words.map((w) => w.term) };
    })()`, true);
  }

  async function chooseFile(name, mime) {
    const bytes = await readFile(path.join(FIXTURES, name));
    const base64 = bytes.toString('base64');
    await evaluate(`(() => {
      const binary = atob(${JSON.stringify(base64)});
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.getElementById('import-file');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  async function previewRows() {
    return evaluate(`[...document.querySelectorAll('#import-preview tbody tr')].map((tr) => ({
      type: tr.querySelector('[data-field="type"]').value,
      term: tr.querySelector('[data-field="term"]').value,
      definition: tr.querySelector('[data-field="definition"]').value,
    }))`);
  }

  async function waitPreview(count, label, timeout = 25000) {
    try {
      await waitFor(`document.querySelectorAll('#import-preview tbody tr').length === ${count}`, timeout, label);
    } catch (error) {
      const debug = await evaluate(`({
        status: document.getElementById('import-status')?.textContent || '',
        error: document.getElementById('import-error')?.textContent || '',
        preview: document.getElementById('import-preview')?.innerText || '',
        rows: document.querySelectorAll('#import-preview tbody tr').length,
      })`).catch(() => ({}));
      throw new Error(`${error.message}；页面状态：${JSON.stringify(debug)}；控制台：${errors.join(' | ')}`);
    }
    return previewRows();
  }

  async function confirmImport() {
    await evaluate("document.getElementById('import-submit').click(); true");
    await waitFor("document.getElementById('import-result') && !document.getElementById('import-result').hidden", 15000, '导入结果');
    await sleep(350);
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
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');

    await waitFor("document.readyState === 'complete' && !!document.querySelector('.app-shell')", 25000, '首页加载');
    await evaluate("location.hash = '#/words'; true");
    await waitFor("!!document.querySelector('[data-action=\"open-import\"]')", 10000, '词库页');
    await evaluate("document.querySelector('[data-action=\"open-import\"]').click(); true");
    await waitFor("!!document.getElementById('import-form')", 8000, '导入弹窗');

    const before = await readLocalState();
    await chooseFile('words.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const xlsxRows = await waitPreview(1, 'Excel 预览');
    await confirmImport();
    const afterXlsx = await readLocalState();
    if (afterXlsx.active !== before.active + 1) throw new Error(`Excel 没有写入 1 个新词：${before.active} -> ${afterXlsx.active}`);

    // 再导入同一个文件：3 条全是重复，预览为空，确认按钮不可点。
    await chooseFile('words.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await waitFor("document.querySelectorAll('#import-preview tbody tr').length === 0 && document.getElementById('import-submit').disabled === true", 20000, 'Excel 重复预览');
    const duplicateStatus = await evaluate("document.getElementById('import-status').textContent");
    const afterDuplicate = await readLocalState();
    if (afterDuplicate.active !== afterXlsx.active) throw new Error('重复导入不应该写入');

    await chooseFile('words.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const docxRows = await waitPreview(1, 'Word 预览');
    if (docxRows[0].term !== '媲美') throw new Error(`Word 去重后剩下的词不对：${JSON.stringify(docxRows)}`);
    await confirmImport();
    const afterDocx = await readLocalState();
    if (afterDocx.active !== afterXlsx.active + 1) throw new Error('Word 没有写入 1 个新词');

    await chooseFile('words.pdf', 'application/pdf');
    const pdfRows = await waitPreview(4, 'PDF 预览');
    const pdfTerms = pdfRows.map((row) => row.term);
    for (const term of ['雷厉风行', '一丝不苟', '鳞次栉比', '踌躇']) {
      if (!pdfTerms.includes(term)) throw new Error(`PDF 没有抽出 ${term}：${JSON.stringify(pdfRows)}`);
    }
    await confirmImport();
    const afterPdf = await readLocalState();
    if (afterPdf.active !== afterDocx.active + 4) throw new Error('PDF 没有写入 4 个词');

    await chooseFile('scan.png', 'image/png');
    try {
      await waitFor("document.querySelectorAll('#import-preview tbody tr').length > 0", 180000, '图片识字预览');
    } catch (error) {
      const debug = await evaluate(`({
        status: document.getElementById('import-status')?.textContent || '',
        error: document.getElementById('import-error')?.textContent || '',
        rows: document.querySelectorAll('#import-preview tbody tr').length,
      })`).catch(() => ({}));
      throw new Error(`${error.message}；页面状态：${JSON.stringify(debug)}；控制台：${errors.join(' | ')}`);
    }
    const imageRows = await previewRows();
    const imageStatus = await evaluate("document.getElementById('import-status').textContent");
    // 确认前改第一条、去掉最后一条，验证预览可编辑。
    const imageExpected = imageRows.length - 1;
    await evaluate(`(() => {
      const first = document.querySelector('#import-preview tbody tr');
      first.querySelector('[data-field="term"]').value = '全神贯注';
      first.querySelector('[data-field="definition"]').value = '全部精神集中在一点上。';
      const buttons = [...document.querySelectorAll('[data-action="import-remove-row"]')];
      if (buttons.length > 1) buttons[buttons.length - 1].click();
      return true;
    })()`);
    await waitFor(`document.querySelectorAll('#import-preview tbody tr').length === ${imageExpected}`, 5000, '去掉一条');
    await confirmImport();
    const afterImage = await readLocalState();
    if (afterImage.active !== afterPdf.active + imageExpected) throw new Error('图片识别后写入数量不对');
    if (!afterImage.terms.includes('全神贯注')) throw new Error('预览里改的词语没有写进词库');

    await chooseFile('scan.pdf', 'application/pdf');
    try {
      await waitFor("document.querySelectorAll('#import-preview tbody tr').length > 0", 180000, '扫描件 PDF 预览');
    } catch (error) {
      const debug = await evaluate(`({
        status: document.getElementById('import-status')?.textContent || '',
        error: document.getElementById('import-error')?.textContent || '',
        rows: document.querySelectorAll('#import-preview tbody tr').length,
      })`).catch(() => ({}));
      throw new Error(`${error.message}；页面状态：${JSON.stringify(debug)}；控制台：${errors.join(' | ')}`);
    }
    const scanPdfRows = await previewRows();
    await confirmImport();
    const afterScanPdf = await readLocalState();
    if (afterScanPdf.active <= afterImage.active) throw new Error('扫描件 PDF 没有写入任何词');

    await chooseFile('legacy.doc', 'application/msword');
    await waitFor("document.getElementById('import-error')?.classList.contains('show')", 10000, '.doc 提示');
    const docError = await evaluate("document.getElementById('import-error').textContent");
    if (!docError.includes('另存为')) throw new Error(`旧 .doc 的提示不对：${docError}`);

    // 原有粘贴入口：先预览，确认后写入。
    await evaluate("document.querySelector('[data-action=\"close-modal\"]').click(); true");
    await evaluate("document.querySelector('[data-action=\"open-import\"]').click(); true");
    await waitFor("!!document.getElementById('import-form')", 8000, '重新打开导入');
    await evaluate(`(() => {
      const area = document.getElementById('import-text');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, '测试粘贴词：只用来验证粘贴、预览和确认。');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('import-form').requestSubmit();
      return true;
    })()`);
    const pasteRows = await waitPreview(1, '粘贴预览');
    if (pasteRows[0].term !== '测试粘贴词') throw new Error(`粘贴预览词语不对：${JSON.stringify(pasteRows)}`);
    await confirmImport();
    const afterPaste = await readLocalState();
    if (afterPaste.active !== afterScanPdf.active + 1) throw new Error('粘贴没有写入 1 个词');

    // 第一次识字后断网刷新，再选图片：确认识别部件已经缓存，离线还能用。
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    await send('Page.reload');
    await waitFor("document.readyState === 'complete' && !!document.querySelector('.app-shell')", 25000, '离线刷新');
    await evaluate("location.hash = '#/words'; true");
    await waitFor("!!document.querySelector('[data-action=\"open-import\"]')", 10000, '离线词库页');
    await evaluate("document.querySelector('[data-action=\"open-import\"]').click(); true");
    await waitFor("!!document.getElementById('import-form')", 8000, '离线导入弹窗');
    await chooseFile('scan.png', 'image/png');
    try {
      await waitFor("!document.getElementById('import-preview').hidden && document.getElementById('import-status').textContent.includes('已读取')", 180000, '离线识字');
    } catch (error) {
      const debug = await evaluate(`({
        status: document.getElementById('import-status')?.textContent || '',
        error: document.getElementById('import-error')?.textContent || '',
      })`).catch(() => ({}));
      throw new Error(`${error.message}；页面状态：${JSON.stringify(debug)}；控制台：${errors.join(' | ')}`);
    }
    const offlineRows = await previewRows();
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });

    if (errors.length) throw new Error(`控制台有错误：\n${errors.join('\n')}`);

    console.log(JSON.stringify({
      ok: true,
      url,
      before: before.active,
      xlsx: { rows: xlsxRows.length, after: afterXlsx.active, duplicateStatus },
      docx: { rows: docxRows, after: afterDocx.active },
      pdf: { rows: pdfRows.length, terms: pdfTerms, after: afterPdf.active },
      image: { rows: imageRows, edited: '全神贯注', after: afterImage.active },
      scannedPdf: { rows: scanPdfRows, after: afterScanPdf.active },
      legacyDoc: docError,
      paste: { rows: pasteRows, after: afterPaste.active },
      offlineImage: { rows: offlineRows.length, ok: true },
      errors,
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
  console.error('导入冒烟测试失败：', error.message);
  process.exit(1);
});
