# DSH-TASK-CF-DEPLOY：把言语词库 V1 发布到免费 Cloudflare

下达：文轩经 DSH云端官 · 2026-11-10
执行方：dsh（本 bot 只布置与验收，不写业务代码）
工作目录：`/workspace/dsh-projects/yanyu-cishu/`（已有 V1，不要另起项目，不要改公考错题本）

## 目标
文轩已拍板并用免费 Cloudflare 账号授权。把现有言语词库 V1 做到可在 **Cloudflare Workers + D1 免费额度** 上稳定运行，给出可给文轩和其他考生长期使用的 HTTPS 公网地址（`*.workers.dev` 即可，不买域名）。

本机 Node 服务（`node server/server.mjs`）要继续能用，不要拆掉。

## 硬约束
- **0 元**：不买域名、不开通 Workers Paid / 任何付费套餐、不绑卡、不产生费用。只用免费档（Workers + D1 + workers.dev）。若某一步必须付费或要文轩再授权，立刻停下来，把原因和可选方案写进验收文档并结束本轮。
- 不要自行 `wrangler login`、不要申请 API Token、不要注册新的云账号、不要打开付费开通页。本机目前没有可发布的 Cloudflare 登录态；**发布动作由布置方用已授权的免费账号执行**，你负责把代码、配置、迁移和本地验证全部做完。
- 不要把本机 `data/app-data.json`（及 backups）上传到 Cloudflare，也不要把它写进仓库或部署包。线上 D1 从空库开始，用户自行注册。
- 不删用户数据；不要改公考错题本仓库；不要把密钥写进仓库。
- 不扩产品功能范围。界面文案、登录方式、同步语义保持 V1。

## 技术要求
1. **静态资源**：继续提供 `public/` 下的页面、样式、脚本、图标、`sw.js`、`manifest`，以及前端会请求的 `/shared/*.mjs`（reducer / schedule / selectors）。Worker 处理 `/api/*`，其余走静态资源。
2. **API 兼容现有前端**：至少保持
   - `GET /api/health`
   - `POST /api/register`
   - `POST /api/login`
   - `POST /api/logout`
   - `POST /api/password`
   - `POST /api/sync`
   请求/响应字段与现有 `public/js/api.js`、`server/server.mjs` 一致（含 Bearer 会话、365 天有效期、冲突与校验文案）。
3. **数据**：用 **D1** 持久化用户、会话、个人词库与学习进度。按用户隔离。可用「每用户一份状态 JSON + 会话表」这类最小迁移，不必重新设计业务模型。密码在 Workers 侧不要用沉重的 scrypt（免费档 CPU 容易超限）；改用 Web Crypto 的 PBKDF2（或同等、适合 Workers 免费档的算法）。线上是空库，不必兼容本机已有 scrypt 哈希。本机 Node 路径可继续用现有 scrypt。
4. **配置**：提供 `wrangler.toml`（或当前推荐的 wrangler 配置）、D1 迁移 SQL、Worker 入口。建议：
   - Worker 名：`yanyu-cishu`
   - D1 名：`yanyu-cishu`
   - 绑定名写清楚（如 `DB`）
   - 兼容日期用较新的稳定值
   - 不要启用付费功能（不要 Durable Objects 付费项、不要自定义域名、不要 R2 付费等）
5. **前端**：尽量少改。若为 HTTPS/`workers.dev` 必须微调 Service Worker 或路径，保持离线外壳缓存和自动同步。
6. **测试**：补/改自动化测试，覆盖 Workers（或与其共用的核心处理）的注册、登录、同步、用户隔离；现有测试不能无故变红。本地用 `wrangler dev` 或同等方式走通主路径（健康检查、注册、登录、同步）。
7. **部署包**：让布置方无需再改代码即可发布。在验收文档写明：wrangler 配置路径、D1 库名、迁移文件、资源目录、Worker 名称、预期地址形态（`https://yanyu-cishu.<subdomain>.workers.dev/`），以及一条免费档发布命令示例（你自己不要真的登录或发布）。

## 最小可交（做到即停）
1. 仓库内已有可在免费 Workers + D1 上运行的实现，本机 Node 路径仍可用。
2. 自动化测试通过；本地对 Worker 主路径做过验证。
3. 写 `docs/CF-DEPLOY-acceptance.md`：实现说明、如何发布、预期公网地址、0 元约束有没有被突破、已知限制（免费额度、学校网是否可能拦截 workers.dev 等如实写）、本机数据未上传。
4. 不要自行向 Cloudflare 创建付费资源或上传用户数据。

完成后退出会话。过程不逐步报文轩。
