export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_OPS = 1500;
export const SESSION_DAYS = 365;

export class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function securityHeaders() {
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

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...securityHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, '提交内容太大');
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) throw new HttpError(413, '提交内容太大');
  if (!buffer.byteLength) return {};
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, '内容格式不正确');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '内容格式不正确');
  }
  return body;
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match ? match[1] : '';
}

export function clientIp(request) {
  const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.length < 200) {
    return forwarded.split(',')[0].trim() || 'unknown';
  }
  return 'unknown';
}

export function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
}

export function validateOps(ops) {
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
