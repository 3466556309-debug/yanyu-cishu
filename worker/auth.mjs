/**
 * Worker 侧密码与会话实现。
 *
 * 免费档 Workers 每次请求只有 10ms CPU。scrypt 在 Workers 上又重又不可用，
 * 这里改用 Web Crypto 的 PBKDF2-HMAC-SHA256（50,000 次迭代）：
 * 本机实测约 7—9ms，配合 D1 读写可以留在免费档预算内。
 * 这是免费档下的折中，验收文档里有如实说明。
 */
const PBKDF2_ITERATIONS = 50000;
const PBKDF2_MAX_ITERATIONS = 100000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const encoder = new TextEncoder();

function toHex(bytes) {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

function fromHex(value) {
  const text = String(value || '');
  if (!text || text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) return null;
  const output = new Uint8Array(text.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterationText, saltText, hashText] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = Number(iterationText);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) {
      return false;
    }
    const salt = fromHex(saltText);
    const expected = fromHex(hashText);
    if (!salt || !expected) return false;
    const actual = await derive(password, salt, iterations);
    return constantTimeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(token)));
  return toHex(new Uint8Array(digest));
}
