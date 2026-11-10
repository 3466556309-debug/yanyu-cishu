import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function normalizeUsername(username) {
  return String(username || '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

export function validateUsername(username) {
  const value = String(username || '').normalize('NFKC').trim();
  if (value.length < 2 || value.length > 24) return '用户名请填写 2—24 个字';
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) return '用户名只能用中文、字母、数字、下划线或短横线';
  return null;
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6) return '密码至少 6 位';
  if (value.length > 128) return '密码太长，请控制在 128 位以内';
  if (!value.trim()) return '密码不能全是空格';
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(String(password), salt, 64, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const derived = await scrypt(String(password), salt, 64, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    const expected = Buffer.from(hash, 'hex');
    const actual = Buffer.from(derived);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}
