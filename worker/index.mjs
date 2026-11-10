import { handleRequest } from './app.mjs';

/**
 * Cloudflare Worker 入口。
 * - /api/*：账号、会话、同步（D1）
 * - 其余路径：交给静态资源绑定（public + shared 的构建产物）
 */
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
