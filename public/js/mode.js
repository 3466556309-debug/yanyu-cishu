/**
 * 运行模式。
 *
 * server：本机 Node 服务或 Cloudflare Workers 版，使用账号与同步接口。
 * local ：GitHub Pages 静态版，词库和进度只保存在当前浏览器。
 *
 * Pages 构建脚本会把这里的值改写为 'local'，源码默认保持 'server'，
 * 以免影响现有 Node / Cloudflare 部署。
 */
export const APP_MODE = 'server';
export const IS_LOCAL_ONLY = APP_MODE === 'local';
