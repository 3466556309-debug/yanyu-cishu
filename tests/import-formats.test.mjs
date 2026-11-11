import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseImport,
  parseImportSource,
  recordsFromTable,
  extractDocxXml,
  layoutPdfText,
} from '../public/js/import-core.js';
import * as XLSX from '../public/vendor/xlsx/xlsx.mjs';
import { unzipSync } from '../public/vendor/fflate/fflate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'import');

test('原有 CSV/TSV/JSON 和粘贴仍然可用，类型没写时四字成语优先', () => {
  const csv = parseImport('类型,词语,释义\n成语,一蹴而就,踏一步就成功\n实词,截至,截止到某个时候');
  assert.deepEqual(csv.rows.map((row) => [row.type, row.term]), [['idiom', '一蹴而就'], ['word', '截至']]);

  const inferred = parseImport('一蹴而就,踏一步就成功\n截至,截止到某个时候');
  assert.deepEqual(inferred.rows.map((row) => [row.type, row.term]), [['idiom', '一蹴而就'], ['word', '截至']]);

  const tsv = parseImport('词语\t释义\t近义\n媲美\t美好的程度差不多\t比美');
  assert.equal(tsv.rows.length, 1);
  assert.equal(tsv.rows[0].type, 'word');
  assert.deepEqual(tsv.rows[0].near, ['比美']);

  const json = parseImport(JSON.stringify([
    { 类型: '成语', 词语: '按部就班', 释义: '按照一定的条理和步骤做事。' },
    { type: '实词', term: '截至', definition: '截止到某个时候。' },
  ]));
  assert.equal(json.rows.length, 2);
  assert.equal(json.rows[0].type, 'idiom');
});

test('冲突规则不变：同类型同字面才跳过，其余照常导入', () => {
  const existing = [{ type: 'idiom', term: '一蹴而就', definition: '旧释义' }];
  const parsed = parseImport('类型,词语,释义\n成语,一蹴而就,新释义\n实词,一蹴而就,另一个类型可以进\n成语,按部就班,按照步骤做事', existing);
  assert.deepEqual(parsed.rows.map((row) => [row.type, row.term]), [['word', '一蹴而就'], ['idiom', '按部就班']]);
  assert.equal(parsed.conflicts.length, 1);
  assert.equal(parsed.conflicts[0].reason, '词库里已经有这个词语');
  assert.equal(parsed.rows[0].definition, '另一个类型可以进');
});

test('没有表头时合理猜列，不整表丢弃', () => {
  const records = recordsFromTable([
    ['成语', '一蹴而就', '踏一步就成功', '关键核心技术不可能一蹴而就。'],
    ['实词', '截至', '截止到某个时候', '截至10月底。'],
  ]);
  assert.deepEqual(records.map((row) => [row.type, row.term, row.definition]), [
    ['成语', '一蹴而就', '踏一步就成功'],
    ['实词', '截至', '截止到某个时候'],
  ]);
});

test('讲义和 OCR 文本能抽出「词语 + 释义」，没有释义的进未能导入', () => {
  const parsed = parseImport([
    '常考词语',
    '一蹴而就：踏一步就成功，形容事情轻而易举。',
    '截至——截止到某个时候。',
    '1. 按部就班 按照一定的条理和步骤做事。',
    '只有词没有释义',
  ].join('\n'));
  assert.deepEqual(parsed.rows.map((row) => [row.type, row.term]), [
    ['idiom', '一蹴而就'], ['word', '截至'], ['idiom', '按部就班'],
  ]);
  assert.ok(parsed.errors.some((item) => /没有找到释义/.test(item.reason)));
});

test('Excel .xlsx 可以读，按表头识别七列', async () => {
  const data = new Uint8Array(await readFile(path.join(FIXTURES, 'words.xlsx')));
  const workbook = XLSX.read(data, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1, raw: false, defval: '', blankrows: false,
  });
  const parsed = parseImportSource({ tables: [{ name: '工作表“词表” ', rows }] });
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows.map((row) => [row.type, row.term]), [
    ['idiom', '一蹴而就'], ['word', '截至'], ['idiom', '按部就班'],
  ]);
  assert.deepEqual(parsed.rows[0].near, ['一步登天']);
  assert.equal(parsed.rows[0].source, '测试讲义');
});

test('旧 .xls 也能读', async () => {
  const data = new Uint8Array(await readFile(path.join(FIXTURES, 'words.xls')));
  const workbook = XLSX.read(data, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1, raw: false, defval: '', blankrows: false,
  });
  const parsed = parseImportSource({ tables: [{ rows }] });
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[1].term, '截至');
});

test('Word .docx 能读表格和正文', async () => {
  const archive = unzipSync(new Uint8Array(await readFile(path.join(FIXTURES, 'words.docx'))));
  assert.ok(archive['word/document.xml']);
  const xml = new TextDecoder().decode(archive['word/document.xml']);
  const { text, tables } = extractDocxXml(xml);
  assert.equal(tables.length, 1);
  assert.match(text, /按部就班/);
  const parsed = parseImportSource({ text, tables });
  assert.deepEqual(parsed.rows.map((row) => [row.type, row.term]), [
    ['idiom', '一蹴而就'], ['word', '截至'], ['idiom', '按部就班'], ['word', '媲美'],
  ]);
});

test('文字型 PDF 能抽出文字、表格和正文词条', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(path.join(FIXTURES, 'words.pdf')));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const chunks = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    chunks.push(layoutPdfText(content.items));
    page.cleanup();
  }
  const text = chunks.join('\n');
  assert.match(text, /雷厉风行/);
  assert.match(text, /鳞次栉比/);
  const parsed = parseImport(text);
  assert.deepEqual(parsed.rows.map((row) => [row.type, row.term]), [
    ['idiom', '鳞次栉比'], ['word', '踌躇'], ['idiom', '雷厉风行'], ['idiom', '一丝不苟'],
  ]);
});

test('识字后的文字走同一套抽取逻辑', () => {
  const ocrText = [
    '言语理解常考词语',
    '一蹴而就：踏一步就成功，形容事情轻而易举。',
    '截至：截止到某个时候。',
    '按部就班：按照一定的条理和步骤做事。',
  ].join('\n');
  const parsed = parseImport(ocrText);
  assert.deepEqual(parsed.rows.map((row) => row.term), ['一蹴而就', '截至', '按部就班']);
  assert.ok(parsed.rows.every((row) => row.definition));
});

test('测试夹具保持小巧，不塞大文件', async () => {
  for (const name of ['words.xlsx', 'words.xls', 'words.docx', 'words.pdf', 'scan.png', 'scan.pdf', 'legacy.doc']) {
    const size = (await readFile(path.join(FIXTURES, name))).length;
    assert.ok(size < 100 * 1024, `${name} 夹具太大：${size}`);
  }
});
