/**
 * 浏览器本地读文件：Excel、Word、PDF、图片、CSV/TXT/TSV/JSON。
 *
 * 所有解析和识字都在本机浏览器完成：不请求本站接口、不调用付费识别服务。
 * 第三方库全部放在 public/vendor/，第一次识字才按需加载中文识别部件。
 */

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const OCR_MAX_IMAGE_SIDE = 2200;
const OCR_MAX_PDF_PAGES = 10;
const OCR_READY_KEY = 'yanyu.ocrReady';

export class ImportFileError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'ImportFileError';
    this.code = code;
    this.hint = hint;
  }
}

function fail(code, message, hint) {
  throw new ImportFileError(code, message, hint);
}

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function vendorUrl(path) {
  return new URL(`../vendor/${path}`, import.meta.url).href;
}

async function readTextSmart(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // 先按 UTF-8 严格解码；失败再试 GBK（很多旧 Excel 导出的 CSV 是 GBK）。
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

function nonEmptyRows(rows) {
  return (rows || []).some((row) => (row || []).some((cell) => String(cell == null ? '' : cell).trim() !== ''));
}

async function parseExcel(file, report) {
  report('正在读取 Excel 表格…');
  let XLSX;
  try {
    XLSX = await import('../vendor/xlsx/xlsx.mjs');
  } catch {
    fail('library', '表格解析部件没有加载成功', '请刷新页面再试；如果是离线，请先联网打开一次。');
  }
  let workbook;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false });
  } catch (error) {
    console.error('[import][xlsx]', error);
    fail('damaged', '这个 Excel 文件打不开，可能已经损坏、加密或不是真正的表格文件',
      '可以在 Excel 里另存为 .xlsx，或把内容复制成 CSV/TXT 再导入。');
  }

  const tables = [];
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    let rows;
    try {
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
    } catch {
      continue;
    }
    if (!nonEmptyRows(rows)) continue;
    tables.push({ name: `工作表“${name}” `, rows });
  }
  if (!tables.length) {
    fail('no-table', '这个 Excel 里没有读到有内容的表格', '确认文件里至少有一行词条，或者把内容直接粘贴进来。');
  }
  const warnings = [];
  if (tables.length > 1) warnings.push(`已读取 ${tables.length} 个工作表里的词条。`);
  return { kind: 'excel', text: '', tables, warnings };
}

async function parseDocx(file, report) {
  report('正在读取 Word 文档…');
  let unzipSync;
  try {
    ({ unzipSync } = await import('../vendor/fflate/fflate.mjs'));
  } catch {
    fail('library', 'Word 解析部件没有加载成功', '请刷新页面再试；如果是离线，请先联网打开一次。');
  }
  let files;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    console.error('[import][docx]', error);
    fail('damaged', '这个 Word 文件打不开，可能已经损坏、加密或不是 .docx',
      '可以在 Word 里另存为 .docx 或 PDF，再选一次。');
  }
  const documentFile = files['word/document.xml'];
  if (!documentFile) {
    fail('damaged', '这个 Word 文件里没有正文，可能是旧格式或已加密',
      '请在 Word 里另存为 .docx 或 PDF，再选一次。');
  }
  const xml = new TextDecoder('utf-8').decode(documentFile);
  const { extractDocxXml } = await import('./import-core.js');
  const { text, tables } = extractDocxXml(xml);
  if (!text.trim() && !tables.length) {
    fail('no-text', '这个 Word 里没有读到文字', '如果正文是图片，可以先截图，再按图片导入。');
  }
  const warnings = [];
  if (tables.length) warnings.push(`Word 里读到 ${tables.length} 个表格，已按表头规则识别。`);
  return { kind: 'docx', text, tables, warnings };
}

let ocrWorkerPromise = null;
let ocrWorker = null;

function ocrReady() {
  try { return localStorage.getItem(OCR_READY_KEY) === '1'; } catch { return false; }
}

function markOcrReady() {
  try { localStorage.setItem(OCR_READY_KEY, '1'); } catch { /* 不影响识别 */ }
}

async function getOcrWorker(report, progress) {
  if (ocrWorkerPromise) return ocrWorkerPromise;
  const firstTime = !ocrReady();
  if (firstTime) {
    report('第一次识字要先加载中文识别部件（约 8 MB），之后可以离线用。正在加载…');
  } else {
    report('正在准备识字部件…');
  }
  ocrWorkerPromise = (async () => {
    let module;
    try {
      const loaded = await import('../vendor/tesseract/tesseract.esm.min.js');
      module = loaded.default || loaded;
    } catch (error) {
      console.error('[import][tesseract]', error);
      fail('library', '识字部件没有加载成功', '请刷新页面再试；如果是离线，请先联网加载一次识别部件。');
    }
    const base = vendorUrl('tesseract');
    try {
      ocrWorker = await module.createWorker('chi_sim', 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/tesseract-core-simd-lstm.wasm.js`,
        langPath: `${base}/lang`,
        workerBlobURL: false,
        gzip: true,
        logger: (message) => {
          if (!message) return;
          if (message.status === 'recognizing text' && typeof message.progress === 'number') {
            progress?.(message.progress);
          }
        },
      });
      markOcrReady();
      return ocrWorker;
    } catch (error) {
      console.error('[import][ocr-worker]', error);
      ocrWorkerPromise = null;
      if (!navigator.onLine) {
        fail('ocr-offline', '现在没有网络，识字部件还没下载过，所以认不出图片',
          '先联网打开一次并识别一张图，之后这个浏览器就能离线识字；也可以改用表格/文字文件。');
      }
      fail('ocr-failed', '识字部件没有启动成功，可能是浏览器不支持或部件没下载完整',
        '换 Chrome/Edge 再试，或先把图片里的词改成表格导入。');
    }
    return null;
  })();
  return ocrWorkerPromise;
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    // 中文 OCR 经常在每个字之间插一个空格；只去掉汉字之间的单空格，
    // 两个以上空格可能表示表格列，保留给后面的表格猜列。
    .replace(/([\u3400-\u9fff])[ \t](?=[\u3400-\u9fff])/g, '$1')
    .replace(/[ \t]+([：:，,。.；;！？!?])/g, '$1')
    .replace(/([：:，,。.；;！？!?])[ \t]+/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function recognize(source, report, progress) {
  const worker = await getOcrWorker(report, progress);
  report('正在识别图片里的文字…第一次会比较慢。');
  let result;
  try {
    result = await worker.recognize(source);
  } catch (error) {
    console.error('[import][ocr]', error);
    fail('ocr-failed', '这张图没认出文字，可能是照片太糊、反光或字太小',
      '换一张清楚一点、正着拍的照片；也可以把词表做成 Excel 或直接粘贴文字。');
  }
  return normalizeOcrText(result?.data?.text);
}

async function imageToCanvas(file) {
  let bitmap;
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file);
  } catch {
    bitmap = null;
  }
  if (bitmap) {
    const scale = Math.min(1, OCR_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (typeof bitmap.close === 'function') bitmap.close();
    return canvas;
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, OCR_MAX_IMAGE_SIDE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImportFileError('image', '这张图片打不开，可能格式不对或文件坏了',
        '换成 JPG/PNG 再试，或者把图片里的文字直接粘进来。'));
    };
    image.src = url;
  });
}

async function parseImage(file, report, progress) {
  report('正在读取图片…');
  const canvas = await imageToCanvas(file);
  const text = await recognize(canvas, report, progress);
  if (text.replace(/\s/g, '').length < 2) {
    fail('no-text', '这张图里没认出字', '换一张更清楚、正着拍、光线均匀的照片；或在确认前直接粘贴文字。');
  }
  return { kind: 'image', text, tables: [], warnings: ['图片识字可能有错字，请在预览里核对后再导入。'] };
}

async function pdfjsModule() {
  let pdfjs;
  try {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  } catch (error) {
    console.error('[import][pdfjs]', error);
    fail('library', 'PDF 解析部件没有加载成功', '请刷新页面再试；如果是离线，请先联网打开一次。');
  }
  pdfjs.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
  return pdfjs;
}

async function ocrPdf(pdf, report, progress) {
  const pages = Math.min(pdf.numPages, OCR_MAX_PDF_PAGES);
  const chunks = [];
  for (let number = 1; number <= pages; number += 1) {
    report(`这份 PDF 像是扫描件，正在识字：第 ${number}/${pages} 页…`);
    const page = await pdf.getPage(number);
    const original = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1800 / Math.max(original.width, 1));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    try {
      const text = await recognize(canvas, report, (value) => progress?.((number - 1 + value) / pages));
      if (text) chunks.push(text);
    } catch (error) {
      if (number === pages && !chunks.length) throw error;
      chunks.push('');
    }
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }
  return chunks.filter(Boolean).join('\n');
}

async function parsePdf(file, report, progress) {
  report('正在读取 PDF…');
  const pdfjs = await pdfjsModule();
  let pdf;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    pdf = await pdfjs.getDocument({
      data,
      cMapUrl: vendorUrl('pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
      isEvalSupported: false,
    }).promise;
  } catch (error) {
    console.error('[import][pdf]', error);
    if (String(error?.name || '').includes('Password')) {
      fail('password', '这个 PDF 加了密码，浏览器里读不了', '先在 PDF 阅读器里去掉密码，或另存为没有密码的 PDF。');
    }
    fail('damaged', '这个 PDF 打不开，可能已经损坏或不是真正的 PDF',
      '换一个 PDF 再试，或把需要的几页截图后按图片导入。');
  }

  const { layoutPdfText } = await import('./import-core.js');
  const warnings = [];
  const chunks = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    report(`正在读取 PDF：第 ${number}/${pdf.numPages} 页…`);
    progress?.(number / pdf.numPages);
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const text = layoutPdfText(content.items);
    if (text.trim()) chunks.push(text);
    page.cleanup();
  }
  let text = chunks.join('\n');
  let scanned = false;

  if (text.replace(/\s/g, '').length < 20 && pdf.numPages > 0) {
    scanned = true;
    const ocrText = await ocrPdf(pdf, report, progress);
    if (ocrText.replace(/\s/g, '').length < 2) {
      fail('no-text', '这份 PDF 里没读到文字，按图片识字也没认出来',
        '换一份能选中文字的 PDF，或把扫描件拍清楚后按图片导入。');
    }
    text = ocrText;
    warnings.push('这份 PDF 像是扫描件，已经按图片识字；结果可能有错字，请在预览里核对。');
    if (pdf.numPages > OCR_MAX_PDF_PAGES) {
      warnings.push(`扫描件只识了前 ${OCR_MAX_PDF_PAGES} 页，后面的页请拆分后再导入。`);
    }
  }

  if (!text.trim()) {
    fail('no-text', '这个 PDF 里没有读到文字', '如果整页是图片，可以截图后按图片导入；也可以改用表格。');
  }
  if (!scanned) warnings.push('PDF 文字按版面抽取，表格列可能错位，请在预览里核对。');
  return { kind: 'pdf', text, tables: [], warnings };
}

/**
 * @param {File} file
 * @param {{report?: (message: string) => void, progress?: (value: number) => void}} options
 * @returns {Promise<{kind: string, text: string, tables: Array, warnings: string[]}>}
 */
export async function readImportFile(file, { report = () => {}, progress = () => {} } = {}) {
  if (!file) fail('empty', '没有选择文件', '点“选择文件”再选一次。');
  if (file.size > MAX_FILE_BYTES) {
    fail('too-large', '文件有点大，请控制在 30MB 以内', '可以只截取需要导入的几页，或拆成几个小文件。');
  }

  const extension = extensionOf(file.name);
  const type = String(file.type || '').toLowerCase();
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif'].includes(extension)
    || /^image\//.test(type);
  const isText = ['csv', 'txt', 'tsv', 'json', 'text', 'md'].includes(extension)
    || /^text\//.test(type) || type === 'application/json';

  try {
    if (extension === 'xlsx' || extension === 'xls' || extension === 'xlsm' || extension === 'xlsb'
      || type.includes('spreadsheetml') || type === 'application/vnd.ms-excel') {
      return await parseExcel(file, report);
    }
    if (extension === 'docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await parseDocx(file, report);
    }
    if (extension === 'doc' || type === 'application/msword') {
      fail('legacy-doc', '旧版 .doc 浏览器里打不开', '请在 Word 里点“另存为”，选 .docx 或 PDF，再选一次。');
    }
    if (extension === 'pdf' || type === 'application/pdf') {
      return await parsePdf(file, report, progress);
    }
    if (isImage) {
      return await parseImage(file, report, progress);
    }
    if (isText) {
      report('正在读取文字…');
      const text = await readTextSmart(file);
      if (!text.trim()) fail('no-text', '这个文件里没有文字', '确认文件不是空的，或把内容直接粘贴进来。');
      return { kind: 'text', text, tables: [], warnings: [] };
    }

    // 后缀不认识时再看内容：纯文本就按文字读，读不出就给出可做的下一步。
    const text = await readTextSmart(file);
    const suspicious = text.includes('\u0000') || (text.match(/\uFFFD/g) || []).length > 20;
    if (text.trim() && !suspicious) return { kind: 'text', text, tables: [], warnings: [] };
    fail('unsupported', '这个文件类型暂时不支持', '可以直接选 Excel、Word（.docx）、PDF、图片，或 CSV/TXT/TSV/JSON。');
  } catch (error) {
    if (error instanceof ImportFileError) throw error;
    console.error('[import][file]', error);
    fail('damaged', '这个文件读不出来，可能已损坏或格式不对', '换一个文件再试，或把内容直接粘贴进来。');
  }
  return null;
}
