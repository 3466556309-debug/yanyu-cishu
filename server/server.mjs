import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { JsonStore } from './db.mjs';
import {
  createSessionToken, hashPassword, hashToken, normalizeUsername, validatePassword,
  validateUsername, verifyPassword,
} from './auth.mjs';
import { createSeedState } from '../shared/seed.mjs';
import { applyOps } from '../shared/reducer.mjs';
import { localDay } from '../shared/schedule.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const SESSION_DAYS = 365;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_OPS = 1500;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function securityHeaders() {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '提交内容太大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '内容格式不正确');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '内容格式不正确');
  }
  return body;
}

function clientIp(req) {
  const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length < 200) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match ? match[1] : '';
}

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
}

function validateOps(ops) {
  if (!Array.isArray(ops)) throw new HttpError(400, '学习记录格式不正确');
  if (ops.length > MAX_OPS) throw new HttpError(413, `一次最多保存 ${MAX_OPS} 条记录`);
  const allowed = new Set([
    'word.upsert', 'word.delete', 'group.upsert', 'group.delete',
    'settings.patch', 'review.record', 'mistake.remove', 'mistake.restore',
  ]);
  return ops.map((op) => {
    if (!op || typeof op !== 'object') throw new HttpError(400, '学习记录格式不正确');
    if (typeof op.opId !== 'string' || !/^[A-Za-z0-9_-]{6,90}$/.test(op.opId)) {
      throw new HttpError(400, '学习记录编号不正确');
    }
    if (!allowed.has(op.type)) throw new HttpError(400, '学习记录类型不正确');
    if (typeof op.at !== 'string' || op.at.length > 40 || !Number.isFinite(Date.parse(op.at))) {
      throw new HttpError(400, '学习记录时间不正确');
    }
    if (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload)) {
      throw new HttpError(400, '学习记录内容不正确');
    }
    return op;
  });
}

export async function createApp(options = {}) {
  const dataFile = options.dataFile || process.env.DATA_FILE || path.join(ROOT, 'data', 'app-data.json');
  const store = await new JsonStore(dataFile).init();
  const loginFailures = new Map();

  function rateKey(req, username) {
    return `${clientIp(req)}|${normalizeUsername(username)}`;
  }

  function checkRate(req, username) {
    const key = rateKey(req, username);
    const item = loginFailures.get(key);
    if (!item) return;
    if (item.blockedUntil && item.blockedUntil > Date.now()) {
      throw new HttpError(429, '尝试次数太多，请过一会儿再试');
    }
    if (Date.now() - item.firstAt > 15 * 60 * 1000) loginFailures.delete(key);
  }

  function recordFailure(req, username) {
    const key = rateKey(req, username);
    const now = Date.now();
    const item = loginFailures.get(key);
    if (!item || now - item.firstAt > 15 * 60 * 1000) {
      loginFailures.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
      return;
    }
    item.count += 1;
    if (item.count >= 10) item.blockedUntil = now + 15 * 60 * 1000;
  }

  function clearFailures(req, username) {
    loginFailures.delete(rateKey(req, username));
  }

  async function authenticate(req) {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, '请先登录', 'AUTH_REQUIRED');
    const tokenHash = hashToken(token);
    const found = await store.read((data) => {
      const session = data.sessions[tokenHash];
      if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
      const user = data.users[session.userId];
      if (!user) return null;
      return { tokenHash, session, user };
    });
    if (!found) throw new HttpError(401, '登录已过期，请重新登录', 'AUTH_REQUIRED');
    return found;
  }

  async function handleRegister(req, res) {
    const body = await readBody(req);
    const usernameError = validateUsername(body.username);
    const passwordError = validatePassword(body.password);
    if (usernameError) throw new HttpError(400, usernameError);
    if (passwordError) throw new HttpError(400, passwordError);
    checkRate(req, body.username);
    const username = String(body.username).normalize('NFKC').trim();
    const norm = normalizeUsername(username);
    const passwordHash = await hashPassword(body.password);
    const token = createSessionToken();
    const tokenHash = hashToken(token);
    const outcome = await store.mutate((data) => {
      if (Object.values(data.users).some((user) => user.normUsername === norm)) {
        return { dirty: false, value: { conflict: true } };
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      const user = {
        id,
        username,
        normUsername: norm,
        passwordHash,
        createdAt: now,
        state: createSeedState(now),
        revision: 1,
        seenOps: [],
      };
      data.users[id] = user;
      data.sessions[tokenHash] = {
        userId: id,
        createdAt: now,
        expiresAt: sessionExpiry(),
      };
      return { value: { user, revision: user.revision } };
    });
    if (outcome.conflict) {
      recordFailure(req, username);
      throw new HttpError(409, '这个用户名已经有人用了，请换一个');
    }
    clearFailures(req, username);
    sendJson(res, 201, {
      ok: true,
      token,
      user: publicUser(outcome.user),
      revision: outcome.revision,
      state: outcome.user.state,
    });
  }

  async function handleLogin(req, res) {
    const body = await readBody(req);
    const username = String(body.username || '').normalize('NFKC').trim();
    checkRate(req, username);
    const norm = normalizeUsername(username);
    const found = await store.read((data) => {
      const user = Object.values(data.users).find((item) => item.normUsername === norm);
      return user ? { id: user.id, passwordHash: user.passwordHash, username: user.username } : null;
    });
    const ok = found ? await verifyPassword(body.password, found.passwordHash) : false;
    if (!found || !ok) {
      recordFailure(req, username);
      throw new HttpError(401, '用户名或密码不对，请再试一次');
    }
    clearFailures(req, username);
    const token = createSessionToken();
    const tokenHash = hashToken(token);
    const result = await store.mutate((data) => {
      const user = data.users[found.id];
      if (!user) return { dirty: false, value: null };
      const now = new Date().toISOString();
      data.sessions[tokenHash] = { userId: user.id, createdAt: now, expiresAt: sessionExpiry() };
      for (const [hash, session] of Object.entries(data.sessions)) {
        if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) delete data.sessions[hash];
      }
      return { value: { user, revision: user.revision } };
    });
    if (!result) throw new HttpError(401, '用户名或密码不对，请再试一次');
    sendJson(res, 200, {
      ok: true,
      token,
      user: publicUser(result.user),
      revision: result.revision,
      state: result.user.state,
    });
  }

  async function handleLogout(req, res) {
    const auth = await authenticate(req);
    await store.mutate((data) => {
      delete data.sessions[auth.tokenHash];
    });
    sendJson(res, 200, { ok: true });
  }

  async function handlePassword(req, res) {
    const auth = await authenticate(req);
    const body = await readBody(req);
    const passwordError = validatePassword(body.newPassword);
    if (passwordError) throw new HttpError(400, passwordError);
    const valid = await verifyPassword(body.currentPassword, auth.user.passwordHash);
    if (!valid) throw new HttpError(400, '现在的密码不对');
    const nextHash = await hashPassword(body.newPassword);
    await store.mutate((data) => {
      const user = data.users[auth.user.id];
      user.passwordHash = nextHash;
      for (const [hash, session] of Object.entries(data.sessions)) {
        if (session.userId === user.id && hash !== auth.tokenHash) delete data.sessions[hash];
      }
    });
    sendJson(res, 200, { ok: true, message: '密码已经改好' });
  }

  async function handleSync(req, res) {
    const auth = await authenticate(req);
    const body = await readBody(req);
    const ops = validateOps(body.ops || []);
    const baseRevision = Number(body.baseRevision) || 0;
    const result = await store.mutate((data) => {
      const user = data.users[auth.user.id];
      if (!user) throw new HttpError(401, '账号不存在', 'AUTH_REQUIRED');
      if (!ops.length && user.revision === baseRevision) {
        return {
          dirty: false,
          value: { notModified: true, revision: user.revision, serverTime: new Date().toISOString() },
        };
      }
      const seen = new Set(user.seenOps || []);
      const fresh = ops.filter((op) => !seen.has(op.opId));
      const duplicates = ops.length - fresh.length;
      let skipped = [];
      let applied = 0;
      if (fresh.length) {
        const run = applyOps(user.state, fresh);
        user.state = run.state;
        applied = run.applied;
        skipped = run.skipped;
        user.revision = (Number(user.revision) || 0) + 1;
        user.seenOps = [...(user.seenOps || []), ...fresh.map((op) => op.opId)].slice(-10000);
      }
      return {
        value: {
          notModified: false,
          revision: user.revision,
          state: user.state,
          applied,
          duplicates,
          skipped,
          serverTime: new Date().toISOString(),
        },
      };
    });
    sendJson(res, 200, { ok: true, ...result });
  }

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, time: new Date().toISOString() });
      return;
    }
    if (pathname === '/api/register' && req.method === 'POST') return handleRegister(req, res);
    if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if (pathname === '/api/password' && req.method === 'POST') return handlePassword(req, res);
    if (pathname === '/api/sync' && req.method === 'POST') return handleSync(req, res);
    throw new HttpError(404, '没有这个服务');
  }

  async function serveFile(req, res, filePath, cacheControl) {
    let info;
    try {
      info = await stat(filePath);
    } catch {
      throw new HttpError(404, '页面不存在');
    }
    if (!info.isFile()) throw new HttpError(404, '页面不存在');
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      ...securityHeaders(),
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': cacheControl,
      'Last-Modified': info.mtime.toUTCString(),
    };
    if (filePath.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '请求方式不支持');
    let cleanPath;
    try {
      cleanPath = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, '地址格式不正确');
    }
    if (cleanPath.includes('\0') || cleanPath.split('/').includes('..')) throw new HttpError(400, '地址格式不正确');
    let filePath;
    let cacheControl = 'public, max-age=0, must-revalidate';
    if (cleanPath === '/' || cleanPath === '/index.html') {
      filePath = path.join(PUBLIC_DIR, 'index.html');
      cacheControl = 'no-cache';
    } else if (cleanPath === '/sw.js') {
      filePath = path.join(PUBLIC_DIR, 'sw.js');
      cacheControl = 'no-cache';
    } else if (cleanPath.startsWith('/shared/')) {
      filePath = path.join(SHARED_DIR, cleanPath.slice('/shared/'.length));
      cacheControl = 'public, max-age=3600';
    } else {
      filePath = path.join(PUBLIC_DIR, cleanPath);
      if (/\.(css|js|mjs|svg|png|webmanifest|ico)$/.test(cleanPath)) cacheControl = 'public, max-age=3600';
    }
    const resolved = path.resolve(filePath);
    const allowedRoot = cleanPath.startsWith('/shared/') ? SHARED_DIR : PUBLIC_DIR;
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) throw new HttpError(404, '页面不存在');
    await serveFile(req, res, resolved, cacheControl);
  }

  const server = createHttpServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url.pathname);
      } else {
        await handleStatic(req, res, url.pathname);
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('[server]', error);
      if (!res.headersSent) {
        sendJson(res, status, {
          ok: false,
          error: error instanceof HttpError ? error.message : '服务暂时出了点问题，请稍后再试',
          code: error.code || '',
        });
      } else {
        res.end();
      }
    } finally {
      if (process.env.LOG_REQUESTS === '1') {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  });

  return { server, store, dataFile };
}

async function main() {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '0.0.0.0';
  const { server } = await createApp();
  server.listen(port, host, () => {
    console.log(`言语词库已启动：http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`);
    console.log(`数据文件：${process.env.DATA_FILE || path.join(ROOT, 'data', 'app-data.json')}`);
    console.log(`今日日期：${localDay()}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  main().catch((error) => {
    console.error('启动失败：', error.message);
    process.exit(1);
  });
}
