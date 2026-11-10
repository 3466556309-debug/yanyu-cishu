export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!response.ok) {
      throw new ApiError(payload.error || '请求没有完成，请稍后再试', response.status, payload.code || '');
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('网络有点慢，请稍后再试', 0, 'TIMEOUT');
    if (error instanceof ApiError) throw error;
    throw new ApiError('现在连不上，记录先保存在这台设备上', 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

export function register(username, password) {
  return request('/api/register', { method: 'POST', body: { username, password }, timeout: 20000 });
}

export function login(username, password) {
  return request('/api/login', { method: 'POST', body: { username, password }, timeout: 20000 });
}

export function logout(token) {
  return request('/api/logout', { method: 'POST', token, body: {} });
}

export function sync(token, baseRevision, ops) {
  return request('/api/sync', {
    method: 'POST', token, body: { baseRevision, ops }, timeout: 25000,
  });
}

export function changePassword(token, currentPassword, newPassword) {
  return request('/api/password', {
    method: 'POST', token, body: { currentPassword, newPassword }, timeout: 20000,
  });
}
