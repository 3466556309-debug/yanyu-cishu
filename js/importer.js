/**
 * 兼容旧导入入口：规则和解析都在 import-core.js。
 * 这里保留 buildImportOps，页面其它地方不用改。
 */
export {
  parseImport,
  parseImportSource,
  finalizeRecords,
  normalizeType,
  inferType,
  splitList,
  HEADER_ALIASES,
} from './import-core.js';

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
