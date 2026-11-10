import { unique } from './util.js';

const HEADER_ALIASES = {
  type: ['类型', '类别', '词性', 'type', 'category'],
  term: ['词语', '词条', '词汇', '成语/实词', 'term', 'word'],
  definition: ['释义', '意思', '解释', 'definition', 'meaning'],
  example: ['例句', '句子', 'example', 'sentence'],
  source: ['来源', '出处', 'source', 'from'],
  near: ['近义', '近义词', '易混', '易混词', 'near', 'synonym'],
  far: ['干扰', '干扰词', '反义', 'far', 'distractor'],
};

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/\s+/g, '').toLowerCase();
}

export function normalizeType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['成语', 'idiom', '成语词', '四字成语'].includes(text)) return 'idiom';
  if (['实词', 'word', '词语', '实词/虚词', '词汇'].includes(text)) return 'word';
  return '';
}

function splitList(value) {
  if (Array.isArray(value)) return unique(value.map((item) => String(item).trim()).filter(Boolean));
  return unique(String(value || '').split(/[、,，;；/]/).map((item) => item.trim()).filter(Boolean));
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // 忽略，下一轮处理 \n
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function objectFromJson(item) {
  return {
    type: item.type ?? item.类型 ?? item.类别,
    term: item.term ?? item.词语 ?? item.词条 ?? item.word,
    definition: item.definition ?? item.释义 ?? item.解释 ?? item.meaning,
    example: item.example ?? item.例句 ?? item.句子,
    source: item.source ?? item.来源 ?? item.出处,
    near: item.near ?? item.近义 ?? item.近义词 ?? item.易混,
    far: item.far ?? item.干扰 ?? item.干扰词,
  };
}

export function parseImport(text, existingWords = []) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { rows: [], errors: [{ line: 0, reason: '没有读到内容' }], conflicts: [] };

  let records = [];
  let errors = [];

  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.words;
      if (!Array.isArray(list)) throw new Error('JSON 需要是词条数组');
      records = list.map((item, index) => ({ ...objectFromJson(item || {}), line: index + 1 }));
    } catch (error) {
      return { rows: [], errors: [{ line: 0, reason: `JSON 读不出来：${error.message}` }], conflicts: [] };
    }
  } else {
    const delimiter = detectDelimiter(raw);
    const table = parseCsv(raw, delimiter).filter((row) => row.some((cell) => String(cell).trim() !== ''));
    if (!table.length) return { rows: [], errors: [{ line: 0, reason: '没有读到内容' }], conflicts: [] };
    const first = table[0].map(normalizeHeader);
    const hasHeader = first.some((cell) => Object.values(HEADER_ALIASES).flat().map(normalizeHeader).includes(cell));
    let map = { type: 0, term: 1, definition: 2, example: 3, source: 4, near: 5, far: 6 };
    if (hasHeader) {
      map = {};
      first.forEach((header, index) => {
        for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
          if (aliases.map(normalizeHeader).includes(header)) map[key] = index;
        }
      });
      table.shift();
    }
    records = table.map((row, index) => ({
      type: row[map.type], term: row[map.term], definition: row[map.definition],
      example: row[map.example], source: row[map.source], near: row[map.near], far: row[map.far],
      line: index + (hasHeader ? 2 : 1),
    }));
  }

  const existing = new Set((existingWords || []).filter((word) => !word.deletedAt)
    .map((word) => `${word.type}|${String(word.term).trim()}`));
  const seen = new Set();
  const rows = [];
  const conflicts = [];

  for (const record of records) {
    const type = normalizeType(record.type);
    const term = String(record.term || '').trim();
    const definition = String(record.definition || '').trim();
    if (!type) {
      errors.push({ line: record.line, reason: `“${term || '空词条'}”的类型不是成语或实词` });
      continue;
    }
    if (!term) {
      errors.push({ line: record.line, reason: '词语为空' });
      continue;
    }
    if (!definition) {
      errors.push({ line: record.line, reason: `“${term}”没有释义` });
      continue;
    }
    if (term.length > 40) {
      errors.push({ line: record.line, reason: `“${term.slice(0, 20)}…”太长` });
      continue;
    }
    const key = `${type}|${term}`;
    if (existing.has(key) || seen.has(key)) {
      conflicts.push({ line: record.line, term, reason: existing.has(key) ? '词库里已经有这个词语' : '这次导入里重复出现' });
      continue;
    }
    seen.add(key);
    rows.push({
      type,
      term,
      definition: definition.slice(0, 3000),
      example: String(record.example || '').trim().slice(0, 3000),
      source: String(record.source || '').trim().slice(0, 300) || '个人导入',
      near: splitList(record.near),
      far: splitList(record.far),
      line: record.line,
    });
  }
  return { rows, errors, conflicts };
}

export function buildImportOps(rows, idFactory) {
  const now = new Date().toISOString();
  return rows.map((row) => ({
    opId: idFactory('op'),
    at: now,
    type: 'word.upsert',
    payload: {
      id: idFactory('word'),
      type: row.type,
      term: row.term,
      definition: row.definition,
      example: row.example,
      source: row.source,
      near: row.near,
      far: row.far,
      createdAt: now,
      updatedAt: now,
    },
  }));
}
