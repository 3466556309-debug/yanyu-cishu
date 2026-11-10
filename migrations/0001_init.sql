-- 言语词库 D1 初始化
-- 线上从空库开始：只建表，不写入任何用户数据。
-- 用户、会话、个人词库/学习进度都按用户隔离：
--   users.state_json   该用户完整的一份状态 JSON（词库、进度、错题、打卡、设置）
--   users.seen_ops_json 已处理过的操作 ID，用于同步幂等
--   sessions.token_hash 只存会话令牌的 SHA-256，不存明文令牌

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  norm_username  TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  state_json     TEXT NOT NULL,
  revision       INTEGER NOT NULL DEFAULT 1,
  seen_ops_json  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
