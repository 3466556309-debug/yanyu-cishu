/**
 * 账号字段的纯校验规则，前后端共用。
 *
 * Node 服务用它保证本机 API 的提示文案不变；Cloudflare Worker 用同一份规则，
 * 避免两条运行路径对用户名、密码的判定出现偏差。
 */

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
