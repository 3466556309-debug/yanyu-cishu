import {
  normalizeUsername, validatePassword, validateUsername,
} from '../shared/auth-rules.mjs';
import { createSeedState } from '../shared/seed.mjs';
import {
  createSessionToken, hashPassword, hashToken, verifyPassword,
} from './auth.mjs';
import { D1Store } from './store.mjs';
import {
  HttpError, bearerToken, clientIp, jsonResponse, publicUser, readBody,
  securityHeaders, sessionExpiry, validateOps,
} from './http.mjs';

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_TIME_MS = 15 * 60 * 1000;
const MAX_TRACKED_FAILURES = 5000;

// Worker 的 isolate 之间不共享内存，所以这是“尽力而为”的限流；
// 对个人/小范围使用足够，不能当成强安全边界。验收文档已写明。
const loginFailures = new Map();

function rateKey(request, username) {
  return `${clientIp(request)}|${normalizeUsername(username)}`;
}

function pruneFailures(now) {
  if (loginFailures.size <= MAX_TRACKED_FAILURES) return;
  for (const [key, item] of loginFailures) {
    if (!item.blockedUntil && now - item.firstAt > FAILURE_WINDOW_MS) loginFailures.delete(key);
  }
  if (loginFailures.size > MAX_TRACKED_FAILURES) loginFailures.clear();
}

function checkRate(request, username) {
  const key = rateKey(request, username);
  const item = loginFailures.get(key);
  if (!item) return;
  const now = Date.now();
  if (item.blockedUntil && item.blockedUntil > now) {
    throw new HttpError(429, '尝试次数太多，请过一会儿再试');
  }
  if (now - item.firstAt > FAILURE_WINDOW_MS) loginFailures.delete(key);
}

function recordFailure(request, username) {
  const key = rateKey(request, username);
  const now = Date.now();
  const item = loginFailures.get(key);
  if (!item || now - item.firstAt > FAILURE_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    pruneFailures(now);
    return;
  }
  item.count += 1;
  if (item.count >= 10) item.blockedUntil = now + BLOCK_TIME_MS;
}

function clearFailures(request, username) {
  loginFailures.delete(rateKey(request, username));
}

function getStore(env) {
  const db = env?.DB;
  if (!db || typeof db.prepare !== 'function') {
    throw new HttpError(500, '服务暂时出了点问题，请稍后再试');
  }
  return new D1Store(db);
}

async function authenticate(request, store) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, '请先登录', 'AUTH_REQUIRED');
  const tokenHash = await hashToken(token);
  const found = await store.authenticate(tokenHash);
  if (!found) throw new HttpError(401, '登录已过期，请重新登录', 'AUTH_REQUIRED');
  return found;
}

function isUniqueError(error) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String(error?.message || error));
}

async function handleRegister(request, store) {
  const body = await readBody(request);
  const usernameError = validateUsername(body.username);
  const passwordError = validatePassword(body.password);
  if (usernameError) throw new HttpError(400, usernameError);
  if (passwordError) throw new HttpError(400, passwordError);

  checkRate(request, body.username);
  const username = String(body.username).normalize('NFKC').trim();
  const norm = normalizeUsername(username);

  // 先查一次，避免为重复用户名白算一次 PBKDF2；并发下的唯一约束仍然兜底。
  const existing = await store.findUserByNorm(norm);
  if (existing) {
    recordFailure(request, username);
    throw new HttpError(409, '这个用户名已经有人用了，请换一个');
  }

  const passwordHash = await hashPassword(body.password);
  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    username,
    normUsername: norm,
    passwordHash,
    createdAt: now,
    state: createSeedState(now),
    revision: 1,
    seenOps: [],
  };

  try {
    await store.createUserWithSession(user, tokenHash, sessionExpiry());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isUniqueError(error)) {
      recordFailure(request, username);
      throw new HttpError(409, '这个用户名已经有人用了，请换一个');
    }
    throw error;
  }

  clearFailures(request, username);
  return jsonResponse({
    ok: true,
    token,
    user: publicUser(user),
    revision: user.revision,
    state: user.state,
  }, 201);
}

async function handleLogin(request, store) {
  const body = await readBody(request);
  const username = String(body.username || '').normalize('NFKC').trim();
  checkRate(request, username);
  const norm = normalizeUsername(username);
  const user = await store.findUserByNorm(norm);
  const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
  if (!user || !ok) {
    recordFailure(request, username);
    throw new HttpError(401, '用户名或密码不对，请再试一次');
  }

  clearFailures(request, username);
  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  try {
    await store.createSession(user.id, tokenHash, sessionExpiry());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // 账号在读取密码后、写入会话前被删掉等极端情况。
    if (/FOREIGN KEY constraint/i.test(String(error?.message || error))) {
      throw new HttpError(401, '用户名或密码不对，请再试一次');
    }
    throw error;
  }

  return jsonResponse({
    ok: true,
    token,
    user: publicUser(user),
    revision: user.revision,
    state: user.state,
  });
}

async function handleLogout(request, store) {
  const auth = await authenticate(request, store);
  await store.deleteSession(auth.tokenHash);
  return jsonResponse({ ok: true });
}

async function handlePassword(request, store) {
  const auth = await authenticate(request, store);
  const body = await readBody(request);
  const passwordError = validatePassword(body.newPassword);
  if (passwordError) throw new HttpError(400, passwordError);
  const valid = await verifyPassword(body.currentPassword, auth.user.passwordHash);
  if (!valid) throw new HttpError(400, '现在的密码不对');
  const nextHash = await hashPassword(body.newPassword);
  await store.changePassword(auth.user.id, auth.tokenHash, nextHash);
  return jsonResponse({ ok: true, message: '密码已经改好' });
}

async function handleSync(request, store) {
  const auth = await authenticate(request, store);
  const body = await readBody(request);
  const ops = validateOps(body.ops || []);
  const baseRevision = Number(body.baseRevision) || 0;
  const result = await store.syncUser(auth.user.id, ops, baseRevision);
  if (!result) throw new HttpError(401, '账号不存在', 'AUTH_REQUIRED');
  return jsonResponse({ ok: true, ...result });
}

async function serveAsset(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response('页面不存在', { status: 404 });
  }
  const response = await env.ASSETS.fetch(request);
  // 生产环境由部署包里的 _headers 统一加安全头；这里再兜底一次，
  // 防止某些本地/预览环境不应用 _headers。
  if (response.headers.has('content-security-policy')) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api/')) {
    try {
      return await serveAsset(request, env);
    } catch (error) {
      console.error('[worker:assets]', error);
      return new Response('页面暂时打不开，请稍后再试', {
        status: 500,
        headers: {
          ...securityHeaders(),
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({ ok: true, time: new Date().toISOString() });
    }

    const route = url.pathname;
    const method = request.method;
    const known = (
      (route === '/api/register' && method === 'POST')
      || (route === '/api/login' && method === 'POST')
      || (route === '/api/logout' && method === 'POST')
      || (route === '/api/password' && method === 'POST')
      || (route === '/api/sync' && method === 'POST')
    );
    if (!known) throw new HttpError(404, '没有这个服务');

    const store = getStore(env);
    if (route === '/api/register') return await handleRegister(request, store);
    if (route === '/api/login') return await handleLogin(request, store);
    if (route === '/api/logout') return await handleLogout(request, store);
    if (route === '/api/password') return await handlePassword(request, store);
    return await handleSync(request, store);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[worker]', error);
    return jsonResponse({
      ok: false,
      error: status >= 500 ? '服务暂时出了点问题，请稍后再试' : (error.message || '请求没有完成'),
      code: error?.code || '',
    }, status);
  }
}
