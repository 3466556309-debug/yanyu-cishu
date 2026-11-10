import { DatabaseSync } from 'node:sqlite';

/**
 * 仅供测试使用的 D1 兼容层（基于 Node 22.5+ 内置的 node:sqlite）。
 * 实现了 Worker 代码用到的 prepare/bind/first/run/all/batch 子集，
 * batch 用 BEGIN/COMMIT 模拟 D1 的事务语义。
 */
class Statement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new Statement(this.database, this.sql, parameters);
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.parameters);
    if (!row) return null;
    if (column) return row[column];
    return { ...row };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
        changed_db: Number(result.changes) > 0,
      },
    };
  }

  async all() {
    const rows = this.database.prepare(this.sql).all(...this.parameters);
    return {
      success: true,
      results: rows.map((row) => ({ ...row })),
      meta: { changes: 0 },
    };
  }
}

export class D1Shim {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // 忽略回滚失败，保留原始错误。
      }
      throw error;
    }
  }

  exec(sql) {
    this.db.exec(sql);
  }
}
