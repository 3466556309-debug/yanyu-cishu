import { applyOps } from '../shared/reducer.mjs';
import { HttpError } from './http.mjs';

const USER_SELECT = `
  SELECT id, username, norm_username, password_hash, created_at,
         state_json, revision, seen_ops_json
    FROM users
`;

function parseState(row) {
  let state;
  let seenOps;
  try {
    state = JSON.parse(row.state_json);
    seenOps = JSON.parse(row.seen_ops_json || '[]');
  } catch {
    throw new Error('用户数据 JSON 解析失败');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('用户数据格式不正确');
  }
  if (!Array.isArray(seenOps)) seenOps = [];
  return { state, seenOps };
}

function toUser(row) {
  const { state, seenOps } = parseState(row);
  return {
    id: row.id,
    username: row.username,
    normUsername: row.norm_username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    state,
    revision: Number(row.revision) || 0,
    seenOps,
  };
}

export class D1Store {
  constructor(db) {
    this.db = db;
  }

  async findUserByNorm(normUsername) {
    const row = await this.db
      .prepare(`${USER_SELECT} WHERE norm_username = ?`)
      .bind(normUsername)
      .first();
    return row ? toUser(row) : null;
  }

  async findUserById(id) {
    const row = await this.db
      .prepare(`${USER_SELECT} WHERE id = ?`)
      .bind(id)
      .first();
    return row ? toUser(row) : null;
  }

  async createUserWithSession(user, tokenHash, expiresAt) {
    const nowIso = new Date().toISOString();
    return this.db.batch([
      this.db.prepare(`
        INSERT INTO users
          (id, username, norm_username, password_hash, created_at, state_json, revision, seen_ops_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        user.id,
        user.username,
        user.normUsername,
        user.passwordHash,
        user.createdAt,
        JSON.stringify(user.state),
        user.revision,
        '[]',
      ),
      this.db.prepare(`
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).bind(tokenHash, user.id, nowIso, expiresAt),
    ]);
  }

  async createSession(userId, tokenHash, expiresAt) {
    const nowIso = new Date().toISOString();
    return this.db.batch([
      this.db.prepare(`
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).bind(tokenHash, userId, nowIso, expiresAt),
      // 与 Node 版一致：登录时顺手清掉已过期的会话。
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowIso),
    ]);
  }

  async authenticate(tokenHash) {
    const nowIso = new Date().toISOString();
    const row = await this.db.prepare(`
      SELECT s.token_hash, s.expires_at,
             u.id, u.username, u.norm_username, u.password_hash, u.created_at,
             u.state_json, u.revision, u.seen_ops_json
        FROM sessions s
        JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
    `).bind(tokenHash).first();
    if (!row) return null;
    if (!row.expires_at || row.expires_at <= nowIso) {
      await this.deleteSession(tokenHash);
      return null;
    }
    return { user: toUser(row), tokenHash, expiresAt: row.expires_at };
  }

  async deleteSession(tokenHash) {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async changePassword(userId, currentTokenHash, passwordHash) {
    return this.db.batch([
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(passwordHash, userId),
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
        .bind(userId, currentTokenHash),
    ]);
  }

  /**
   * 乐观并发：读当前 revision，带 revision 条件写回；被别的请求抢先时重试。
   * 这样多台设备同时同步不会把彼此的学习记录覆盖掉。
   */
  async syncUser(userId, ops, baseRevision) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const user = await this.findUserById(userId);
      if (!user) return null;
      const serverTime = new Date().toISOString();

      if (!ops.length && user.revision === baseRevision) {
        return {
          notModified: true,
          revision: user.revision,
          serverTime,
        };
      }

      const seen = new Set(user.seenOps);
      const fresh = ops.filter((op) => !seen.has(op.opId));
      const duplicates = ops.length - fresh.length;
      if (!fresh.length) {
        return {
          notModified: false,
          revision: user.revision,
          state: user.state,
          applied: 0,
          duplicates,
          skipped: [],
          serverTime,
        };
      }

      const run = applyOps(user.state, fresh);
      const nextRevision = user.revision + 1;
      const seenOps = [...user.seenOps, ...fresh.map((op) => op.opId)].slice(-10000);
      const result = await this.db.prepare(`
        UPDATE users
           SET state_json = ?, revision = ?, seen_ops_json = ?
         WHERE id = ? AND revision = ?
      `).bind(
        JSON.stringify(run.state),
        nextRevision,
        JSON.stringify(seenOps),
        userId,
        user.revision,
      ).run();

      if (Number(result?.meta?.changes) === 1) {
        return {
          notModified: false,
          revision: nextRevision,
          state: run.state,
          applied: run.applied,
          duplicates,
          skipped: run.skipped,
          serverTime,
        };
      }
      // 另一个请求已经写入；重新读取后再合并本次操作。
    }
    throw new HttpError(409, '同步冲突，请稍后再试', 'SYNC_CONFLICT');
  }
}
