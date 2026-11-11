/**
 * 导入解析的纯逻辑：不碰 DOM、不联网，Node 测试和浏览器共用。
 *
 * 支持：
 * - CSV/TXT/TSV/JSON 文本
 * - 二维表格（Excel、Word 表格、PDF 里抽出的表）
 * - 讲义/照片识别后的正文，从中猜出「词语 + 释义」
 *
 * 冲突规则与原版一致：同一类型 + 词语字面完全一样才算重复；
 * 只跳过冲突的那几条，绝不覆盖已有词。
 */

export const HEADER_ALIASES = {
  type: ['类型', '类别', '词性', '词类', 'type', 'category'],
  term: ['词语', '词条', '词汇', '成语/实词', 'term', 'word'],
  definition: ['释义', '意思', '解释', '含义', 'definition', 'meaning'],
  example: ['例句', '句子', 'example', 'sentence'],
  source: ['来源', '出处', 'source', 'from'],
  near: ['近义', '近义词', '易混', '易混词', 'near', 'synonym'],
  far: ['干扰', '干扰词', '反义', 'far', 'distractor'],
};

const TYPE_IDIOM = ['成语', 'idiom', '成语词', '四字成语'];
const TYPE_WORD = ['实词', 'word', '词语', '实词/虚词', '词汇'];
const MAX_TERM_LENGTH = 40;
const MAX_DEFINITION_LENGTH = 3000;

export function normalizeHeader(value) {
  return String(value == null ? '' : value).replace(/^\uFEFF/, '').replace(/\s+/g, '').toLowerCase();
}

export function normalizeType(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (TYPE_IDIOM.includes(text)) return 'idiom';
  if (TYPE_WORD.includes(text)) return 'word';
  return '';
}

export function inferType(term) {
  const compact = String(term == null ? '' : term).replace(/\s+/g, '');
  return /^[\u3400-\u9fff]{4}$/.test(compact) ? 'idiom' : 'word';
}

export function splitList(value) {
  const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[、,，;；/]/);
  const seen = new Set();
  const output = [];
  for (const item of list) {
    const text = String(item == null ? '' : item).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

export function parseCsv(text, delimiter = ',') {
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
      // 下一轮处理 \n。
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

export function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\u00a0/g, ' ').trim();
}

function charLength(value) {
  return Array.from(String(value || '')).length;
}

function isBlankRow(row) {
  return !row || row.every((cell) => cellText(cell) === '');
}

export function trimTable(table) {
  const rows = (table || []).map((row) => (Array.isArray(row) ? row.map(cellText) : [cellText(row)]));
  while (rows.length && isBlankRow(rows[0])) rows.shift();
  while (rows.length && isBlankRow(rows[rows.length - 1])) rows.pop();
  if (!rows.length) return [];
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  const kept = [];
  for (let col = 0; col < width; col += 1) {
    if (rows.some((row) => cellText(row[col]) !== '')) kept.push(col);
  }
  return rows.map((row) => kept.map((col) => cellText(row[col])));
}

export function findHeaderMap(row) {
  const map = {};
  let matched = 0;
  (row || []).forEach((cell, index) => {
    const header = normalizeHeader(cell);
    if (!header) return;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.map(normalizeHeader).includes(header) && map[key] == null) {
        map[key] = index;
        matched += 1;
      }
    }
  });
  // 只有“词语”一个词不算表头，避免把正文里的“词语”标题当成列名。
  if (matched < 2 || map.term == null) return null;
  return map;
}

function columnValues(rows, index, sample = 30) {
  const values = [];
  for (const row of rows.slice(0, sample)) {
    const value = cellText(row[index]);
    if (value) values.push(value);
  }
  return values;
}

function scoreTermColumn(values) {
  if (!values.length) return -Infinity;
  let score = 0;
  for (const value of values) {
    const length = charLength(value);
    if (length >= 2 && length <= 12) score += 3;
    else if (length <= 20) score += 1;
    else score -= 3;
    if (!/[。！？；;]/.test(value)) score += 1;
    if (/^[\u3400-\u9fffA-Za-z0-9·【】\[\]（）()《》\s]+$/.test(value)) score += 1;
    if (/^\d+([.．]\d+)?$/.test(value)) score -= 4;
  }
  return score / values.length;
}

function scoreDefinitionColumn(values) {
  if (!values.length) return -Infinity;
  let total = 0;
  for (const value of values) {
    const length = charLength(value);
    if (length >= 8) total += 3;
    else if (length >= 4) total += 1;
    else total -= 2;
    if (/[。！？；，,：:]/.test(value)) total += 2;
    if (/^\d+([.．]\d+)?$/.test(value)) total -= 4;
  }
  return total / values.length;
}

/**
 * 没有表头时猜列：先找全是“成语/实词”的类型列，再按词长和句读猜词语、释义。
 * 猜不出也至少给词语、释义一个可用位置，避免整表丢弃。
 */
export function guessTableMap(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const valuesByColumn = [];
  for (let col = 0; col < width; col += 1) valuesByColumn.push(columnValues(rows, col));

  let type = null;
  for (let col = 0; col < width; col += 1) {
    const values = valuesByColumn[col];
    if (values.length >= 1 && values.every((value) => normalizeType(value))) {
      type = col;
      break;
    }
  }

  let term = null;
  let bestTerm = -Infinity;
  for (let col = 0; col < width; col += 1) {
    if (col === type) continue;
    const score = scoreTermColumn(valuesByColumn[col]);
    if (score > bestTerm) {
      bestTerm = score;
      term = col;
    }
  }

  let definition = null;
  let bestDefinition = -Infinity;
  const definitionCandidates = [];
  for (let col = 0; col < width; col += 1) {
    if (col === type || col === term) continue;
    const score = scoreDefinitionColumn(valuesByColumn[col]);
    if (score > bestDefinition) {
      bestDefinition = score;
      definition = col;
    }
    if (score >= 1) definitionCandidates.push(col);
  }
  // 没有表头时优先取“词语后面第一列像释义的”，避免把更长的例句当释义。
  if (definitionCandidates.length) definition = definitionCandidates.sort((a, b) => a - b)[0];

  if (term == null && width) term = type === 0 ? 1 : 0;
  if (definition == null) {
    if (term == null) definition = width > 1 ? 1 : null;
    else if (term + 1 < width) definition = term + 1;
    else if (term > 0) definition = term - 1;
  }
  if (definition === type) definition = null;
  if (term === definition) definition = term + 1 < width ? term + 1 : null;

  const map = { term, definition };
  if (type != null) map.type = type;
  // 无表头时，第三列之后不硬猜近义/干扰，避免把例句当近义词。
  return map;
}

function completeMap(rows, map) {
  const output = { ...map };
  if (output.term == null || output.definition == null) {
    const guessed = guessTableMap(rows);
    if (output.term == null) output.term = guessed.term;
    if (output.definition == null) output.definition = guessed.definition;
  }
  return output;
}

/**
 * 二维表格 -> 原始记录。行号从 lineOffset 开始，1 表示表格第一行。
 */
export function recordsFromTable(table, { lineOffset = 1, where = '' } = {}) {
  const rows = trimTable(table);
  if (!rows.length) return [];
  const headerMap = findHeaderMap(rows[0]);
  let map;
  let start = 0;
  if (headerMap) {
    map = completeMap(rows.slice(1), headerMap);
    start = 1;
  } else {
    map = guessTableMap(rows);
  }

  const records = [];
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankRow(row)) continue;
    const get = (key) => (map[key] == null ? '' : cellText(row[map[key]]));
    records.push({
      type: get('type'),
      term: get('term'),
      definition: get('definition'),
      example: get('example'),
      source: get('source'),
      near: get('near'),
      far: get('far'),
      line: index + lineOffset,
      where,
    });
  }
  return records;
}

export function tableFromDelimitedText(text, delimiter = detectDelimiter(text)) {
  return parseCsv(String(text || ''), delimiter).filter((row) => !isBlankRow(row));
}

function headerLike(line) {
  const normalized = normalizeHeader(line).replace(/[|｜]/g, '');
  if (!normalized) return true;
  const aliases = Object.values(HEADER_ALIASES).flat().map(normalizeHeader);
  if (aliases.includes(normalized)) return true;
  const tokens = String(line).trim().split(/[\s|｜,，]+/).map(normalizeHeader).filter(Boolean);
  if (tokens.length >= 2 && tokens.filter((token) => aliases.includes(token)).length >= 2) return true;
  // 常见讲义标题，避免被当成“词语 + 下一行释义”。
  if (/^(词语|词条|词汇|成语|实词|释义|解释|例句|目录|附录|常考成语|高频成语|常考实词|高频实词|第[一二三四五六七八九十百\d]+[章节讲部分]|.*(词表|词汇表|成语表|实词表|讲义|练习题|参考答案))$/.test(normalized)) return true;
  // 文档大标题（如“言语理解常考词语”）不是词条。
  return charLength(normalized) >= 6
    && /(言语理解|行测|常考|高频|讲义|词表|词汇表|成语表|实词表|练习题|参考答案|目录|附录)/.test(normalized)
    && !/[：:，,。！？]/.test(normalized);
}

function looksLikePageNumber(line) {
  return /^[\s\-—–_·.()（）]*(?:第\s*)?\d{1,4}\s*(?:页)?[\s\-—–_·.()（）]*$/.test(line);
}

function stripBullet(line) {
  return line
    .replace(/^\s*(?:第\s*)?\d{1,4}\s*[、.．)）]\s*/, '')
    .replace(/^\s*[（(]\s*\d{1,4}\s*[)）]\s*/, '')
    .replace(/^\s*[·•●▪◆◇※*\-—–]+\s*/, '')
    .trim();
}

function cleanTerm(value) {
  let term = String(value == null ? '' : value)
    .replace(/^[\s【\[（(《<]+/, '')
    .replace(/[\s】\]）)》>]+$/, '')
    .replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, '')
    .trim();
  term = term
    .replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/^(成语|实词)\s*[·、,，:：\-—]?\s*/, '')
    .trim();
  return term;
}

function cleanDefinition(value) {
  return String(value == null ? '' : value)
    .replace(/^[\s:：\-—–·,，;；]+/, '')
    .replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchInlineEntry(line) {
  let body = line.trim();
  let explicitType = '';
  const typePrefix = body.match(/^(成语|实词)\s*[·、,，:：\-—]?\s+/);
  if (typePrefix) {
    explicitType = typePrefix[1];
    body = body.slice(typePrefix[0].length).trim();
  }

  const patterns = [
    /^(.{2,24}?)\s*[：:]\s*(.{2,})$/,
    /^(.{2,24}?)\s*[—–]{1,2}\s*(.{2,})$/,
    /^([\u3400-\u9fffA-Za-z0-9·【】\[\]（）()《》]{2,20})\s+(.{2,})$/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (!match) continue;
    const term = cleanTerm(match[1]);
    const definition = cleanDefinition(match[2]);
    if (!term || !definition) continue;
    if (/[。！？；;]/.test(term)) continue;
    if (charLength(term) < 2 || charLength(term) > 24) continue;
    if (charLength(definition) < 2) continue;
    return { term, definition, type: explicitType };
  }

  // “一蹴而就，踏一步就成功”这种用逗号隔开的四字成语解释。
  const idiomComma = body.match(/^([\u3400-\u9fff]{4})\s*[，,]\s*(.{4,})$/);
  if (idiomComma) {
    return { term: idiomComma[1], definition: cleanDefinition(idiomComma[2]), type: explicitType };
  }

  return null;
}

function isTermOnly(line) {
  const term = cleanTerm(line);
  if (!term || /[。！？；;，,：:]/.test(term)) return false;
  const length = charLength(term);
  if (length < 2 || length > 24) return false;
  return /^[\u3400-\u9fffA-Za-z0-9·]+$/.test(term);
}

function looksLikeDefinitionLine(line) {
  const text = line.trim();
  if (!text) return false;
  if (headerLike(text)) return false;
  if (looksLikePageNumber(text)) return false;
  if (isTermOnly(text)) return charLength(text) >= 8;
  return charLength(text) >= 4;
}

function definitionAfterTerm(next, term) {
  if (!next || headerLike(next) || looksLikePageNumber(next)) return '';
  if (matchInlineEntry(next)) return '';
  if (isTermOnly(next) && charLength(next) <= Math.max(4, charLength(term))) return '';
  if (charLength(next) < 4) return '';
  return next;
}

/**
 * 从讲义、OCR 文字里抽词。
 * 已识别的形态：词语：释义、词语 释义、词语——释义、四字成语，释义、
 * 「词语」单独一行 + 下一段释义、编号/项目符号列表。
 */
export function extractProseRecords(text) {
  const records = [];
  const errors = [];
  const warnings = [];
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').trim())
    .filter((line) => line && !looksLikePageNumber(line));

  let current = null;
  let pendingTerm = null;

  const pushPending = () => {
    if (!pendingTerm) return;
    errors.push({
      line: pendingTerm.line,
      term: pendingTerm.term,
      reason: `“${pendingTerm.term}”看起来像词，但前后都没有找到释义`,
    });
    pendingTerm = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripBullet(raw);
    if (!line || headerLike(line)) {
      pushPending();
      current = null;
      continue;
    }

    const inline = matchInlineEntry(line);
    if (inline) {
      pushPending();
      current = {
        type: inline.type,
        term: inline.term,
        definition: inline.definition,
        line: index + 1,
        where: '',
      };
      records.push(current);
      continue;
    }

    if (isTermOnly(line)) {
      // 先看下一行：是“词语 + 释义”还是另一个词。
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
      const next = nextIndex < lines.length ? stripBullet(lines[nextIndex]).trim() : '';
      const paired = definitionAfterTerm(next, line);
      if (paired) {
        pushPending();
        current = {
          type: '',
          term: cleanTerm(line),
          definition: cleanDefinition(paired),
          line: index + 1,
          where: '',
        };
        records.push(current);
        index = nextIndex;
        continue;
      }
      pushPending();
      pendingTerm = { term: cleanTerm(line), line: index + 1 };
      current = null;
      continue;
    }

    // 上一段的续行：OCR/讲义常见一句释义折成几行。
    if (current && looksLikeDefinitionLine(line)) {
      current.definition = `${current.definition}${current.definition ? ' ' : ''}${cleanDefinition(line)}`.trim();
      continue;
    }
    if (pendingTerm) {
      const paired = definitionAfterTerm(line, pendingTerm.term);
      if (paired) {
        current = {
          type: '',
          term: pendingTerm.term,
          definition: cleanDefinition(paired),
          line: pendingTerm.line,
          where: '',
        };
        records.push(current);
        pendingTerm = null;
        continue;
      }
    }

    // 明显不是词条的长段落，不硬造词；只留一条白话提示。
    if (charLength(line) > 30) {
      warnings.push(`有一段文字没有明显的“词语 + 释义”格式，已跳过：${line.slice(0, 28)}…`);
    }
    current = null;
  }
  pushPending();

  return {
    records: records.filter((record) => record.term && record.definition),
    errors,
    warnings: warnings.slice(0, 8),
  };
}

export function looksLikeTabularText(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 40);
  if (!lines.length) return false;
  if (findHeaderMap(parseCsv(lines[0], detectDelimiter(lines[0]))[0] || [])) return true;
  const tabbed = lines.filter((line) => line.includes('\t'));
  if (tabbed.length >= 2) return true;
  const delimiter = detectDelimiter(lines[0]);
  if (delimiter === ',') {
    const counts = lines.map((line) => (line.match(/,/g) || []).length);
    const withDelimiter = counts.filter((count) => count > 0).length;
    if (withDelimiter >= 2 && withDelimiter / lines.length >= 0.6) {
      const same = counts.filter((count) => count === counts[0]).length;
      if (same / lines.length >= 0.6) return true;
    }
    if (lines.length === 1 && counts[0] >= 2) return true;
  }
  if (delimiter === ';') {
    const withDelimiter = lines.filter((line) => line.includes(';')).length;
    if (withDelimiter >= 2 && withDelimiter / lines.length >= 0.6) return true;
  }
  return false;
}

export function finalizeRecords(records, existingWords = []) {
  const existing = new Set((existingWords || [])
    .filter((word) => word && !word.deletedAt)
    .map((word) => `${word.type}|${String(word.term || '').trim()}`));
  const seen = new Set();
  const rows = [];
  const errors = [];
  const conflicts = [];

  for (const record of records) {
    const rawType = String(record.type == null ? '' : record.type).trim();
    const term = cleanTerm(record.term);
    const definition = cleanDefinition(record.definition);
    if (!term) {
      errors.push({ line: record.line, where: record.where, reason: '词语为空' });
      continue;
    }
    if (!definition) {
      errors.push({
        line: record.line,
        where: record.where,
        term,
        reason: `“${term}”没有释义，先不放进词库`,
      });
      continue;
    }
    if (charLength(term) > MAX_TERM_LENGTH) {
      errors.push({
        line: record.line,
        where: record.where,
        term,
        reason: `“${term.slice(0, 20)}…”太长，不像一个词`,
      });
      continue;
    }

    let type = normalizeType(rawType);
    if (!type && rawType) {
      errors.push({
        line: record.line,
        where: record.where,
        term,
        reason: `“${term}”的类型“${rawType}”不是成语或实词`,
      });
      continue;
    }
    if (!type) type = inferType(term);

    const key = `${type}|${term}`;
    if (existing.has(key) || seen.has(key)) {
      conflicts.push({
        line: record.line,
        where: record.where,
        term,
        reason: existing.has(key) ? '词库里已经有这个词语' : '这次导入里重复出现',
      });
      continue;
    }
    seen.add(key);
    rows.push({
      type,
      term,
      definition: definition.slice(0, MAX_DEFINITION_LENGTH),
      example: String(record.example || '').trim().slice(0, MAX_DEFINITION_LENGTH),
      source: String(record.source || '').trim().slice(0, 300) || '个人导入',
      near: splitList(record.near),
      far: splitList(record.far),
      line: record.line,
      where: record.where || '',
    });
  }

  return { rows, errors, conflicts };
}

function objectFromJson(item) {
  return {
    type: item?.type ?? item?.类型 ?? item?.类别,
    term: item?.term ?? item?.词语 ?? item?.词条 ?? item?.word,
    definition: item?.definition ?? item?.释义 ?? item?.解释 ?? item?.meaning,
    example: item?.example ?? item?.例句 ?? item?.句子,
    source: item?.source ?? item?.来源 ?? item?.出处,
    near: item?.near ?? item?.近义 ?? item?.近义词 ?? item?.易混,
    far: item?.far ?? item?.干扰 ?? item?.干扰词,
  };
}

export function splitTabularText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  const prose = [];
  let current = [];
  const flush = () => {
    if (current.filter((line) => line.trim()).length) blocks.push(current);
    current = [];
  };
  for (const line of lines) {
    if (line.includes('\t')) current.push(line);
    else {
      flush();
      prose.push(line);
    }
  }
  flush();
  return { blocks, prose };
}

/**
 * 文本导入主入口，保持旧版 parseImport(text, existingWords) 的用法。
 */
export function parseImport(text, existingWords = []) {
  const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
  if (!raw) return { rows: [], errors: [{ line: 0, reason: '没有读到内容' }], conflicts: [], warnings: [] };

  let records = [];
  const warnings = [];
  let parseErrors = [];

  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.words;
      if (!Array.isArray(list)) throw new Error('JSON 需要是词条数组');
      records = list.map((item, index) => ({ ...objectFromJson(item || {}), line: index + 1, where: '' }));
    } catch (error) {
      return {
        rows: [],
        errors: [{ line: 0, reason: `JSON 读不出来：${error.message}` }],
        conflicts: [],
        warnings: [],
      };
    }
  } else if (looksLikeTabularText(raw)) {
    const delimiter = raw.includes('\t') ? '\t' : detectDelimiter(raw);
    if (delimiter === '\t') {
      // PDF/OCR 常见“正文 + 表格”混排：表格块按表头解析，正文另外抽词。
      const { blocks, prose } = splitTabularText(raw);
      for (const block of blocks) {
        const table = tableFromDelimitedText(block.join('\n'), '\t');
        records.push(...recordsFromTable(table));
      }
      const proseText = prose.join('\n').trim();
      if (proseText) {
        const extracted = extractProseRecords(proseText);
        records.push(...extracted.records);
        parseErrors.push(...extracted.errors);
        warnings.push(...extracted.warnings);
      }
      if (!records.length && !parseErrors.length) {
        return { rows: [], errors: [{ line: 0, reason: '没有读到内容' }], conflicts: [], warnings: [] };
      }
    } else {
      const table = tableFromDelimitedText(raw, delimiter);
      if (!table.length) return { rows: [], errors: [{ line: 0, reason: '没有读到内容' }], conflicts: [], warnings: [] };
      records = recordsFromTable(table);
    }
  } else {
    const extracted = extractProseRecords(raw);
    records = extracted.records;
    parseErrors = extracted.errors;
    warnings.push(...extracted.warnings);
  }

  const result = finalizeRecords(records, existingWords);
  return {
    rows: result.rows,
    errors: [...parseErrors, ...result.errors],
    conflicts: result.conflicts,
    warnings,
  };
}

/**
 * 文件解析结果 -> 词条。tables 是二维数组；text 是正文（Word 正文、PDF 文字、OCR 文字）。
 */
export function parseImportSource(source, existingWords = []) {
  const tables = Array.isArray(source?.tables) ? source.tables : [];
  const text = String(source?.text || '');
  const warnings = [...(source?.warnings || [])];
  const records = [];
  const errors = [];

  tables.forEach((table, index) => {
    const rows = Array.isArray(table) ? table : table?.rows;
    if (!Array.isArray(rows)) return;
    const where = table?.name || (tables.length > 1 ? `第 ${index + 1} 个表格` : '');
    records.push(...recordsFromTable(rows, { where }));
  });

  // 只有正文时直接走文本导入，保留“正文 + 表格混排”的处理。
  if (!tables.length && text.trim()) {
    const result = parseImport(text, existingWords);
    return {
      ...result,
      warnings: [...new Set([...warnings, ...(result.warnings || [])])].slice(0, 8),
    };
  }

  if (text.trim()) {
    const extracted = extractProseRecords(text);
    records.push(...extracted.records);
    errors.push(...extracted.errors);
    warnings.push(...extracted.warnings);
  }

  const result = finalizeRecords(records, existingWords);
  return {
    rows: result.rows,
    errors: [...errors, ...result.errors],
    conflicts: result.conflicts,
    warnings: [...new Set(warnings)].slice(0, 8),
  };
}

/* ==================== Word（.docx） ==================== */

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function paragraphText(xml) {
  let output = '';
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
  let match;
  while ((match = token.exec(xml))) {
    if (match[1] != null) output += decodeXmlEntities(match[1]);
    else if (match[0].startsWith('<w:tab')) output += '\t';
    else output += '\n';
  }
  return output;
}

function cellTextFromXml(xml) {
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => paragraphText(match[0]));
  if (!paragraphs.length) return paragraphText(xml).replace(/\s+/g, ' ').trim();
  return paragraphs.map((line) => line.trim()).filter(Boolean).join(' ').trim();
}

/**
 * 从 word/document.xml 抽正文和表格，不依赖 DOMParser，Node 里也能测。
 */
export function extractDocxXml(xml) {
  const source = String(xml || '');
  const tables = [];
  for (const tableMatch of source.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)) {
    const rows = [];
    for (const rowMatch of tableMatch[0].matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)) {
      const cells = [...rowMatch[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)]
        .map((cell) => cellTextFromXml(cell[0]));
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }

  const withoutTables = source.replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, '\n');
  const paragraphs = [...withoutTables.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((match) => paragraphText(match[0]).trim())
    .filter(Boolean);
  return { text: paragraphs.join('\n'), tables };
}

/* ==================== PDF 文本排版 ==================== */

/**
 * 把 pdf.js 的 textContent.items 按坐标还原成带换行/制表符的文本。
 * 制表符用来保留表格列，后面的表格猜测会用到。
 */
export function layoutPdfText(items) {
  const glyphs = [];
  for (const item of items || []) {
    const str = String(item?.str == null ? '' : item.str);
    if (!str) continue;
    const transform = item.transform || [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const height = Math.abs(Number(transform[3]) || Number(item.height) || 10);
    glyphs.push({ str, x, y, width: Number(item.width) || 0, height, hasEOL: !!item.hasEOL });
  }
  if (!glyphs.length) return '';

  const rows = [];
  for (const item of glyphs) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(1.8, item.height * 0.35));
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  rows.sort((a, b) => b.y - a.y);

  const lines = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let previous = null;
    for (const item of row.items) {
      if (!line) {
        line = item.str;
      } else {
        const previousEnd = previous.x + previous.width;
        const gap = item.x - previousEnd;
        const left = line.slice(-1);
        const right = item.str[0] || '';
        const cjk = /[\u3000-\u9fff\uff00-\uffef]/.test(left) || /[\u3000-\u9fff\uff00-\uffef]/.test(right);
        if (/^\s+$/.test(item.str)) {
          // PDF 里的空格也占宽度；大空格按表格列处理，小空格保留为普通空格。
          line += item.width > Math.max(7, item.height * 0.5) ? '\t' : ' ';
        } else if (/^\s/.test(item.str) || /\s$/.test(line)) line += item.str;
        else if (gap > Math.max(12, item.height * 1.3)) line += `\t${item.str}`;
        else if (!cjk && gap > Math.max(1.2, item.height * 0.12)) line += ` ${item.str}`;
        else line += item.str;
      }
      if (item.hasEOL) line += '\n';
      previous = item;
    }
    if (line.trim()) lines.push(line.replace(/[ \t]+$/g, ''));
  }
  return lines.join('\n');
}
