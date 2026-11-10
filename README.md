# 言语词库 V1

公务员、事业单位「言语理解」成语与实词记忆系统。项目独立于「公考错题本」，不共用账号或数据。

## 在线使用（GitHub Pages 静态版）

### https://3466556309-debug.github.io/yanyu-cishu/

打开就能用，不用注册、登录。词库和学习进度只保存在每个人自己的浏览器（IndexedDB）里，不会上传，也不会跨设备同步。换设备或清理浏览器数据后不会自动恢复；换设备前可在“设置”里下载备份。

- 免费公开仓库 + GitHub Pages，0 元，无域名、无服务器数据库。
- 与 Cloudflare 登录同步版并存，互不影响。
- 发布与验收说明：`docs/PAGES-acceptance.md`
- 重新构建：`npm run pages:build`，产物在 `pages-dist/`（gitignore）。
- 公网/本机冒烟：`node scripts/smoke-pages.mjs <url>` 或 `node scripts/smoke-pages.mjs --dir pages-dist /yanyu-cishu/`

## 本机运行（Node）

需要 Node.js 20 以上，无第三方运行依赖：

```bash
node server/server.mjs
```

默认打开 `http://127.0.0.1:8080/`，监听 `0.0.0.0:8080`。可用环境变量：

```bash
PORT=8080 HOST=0.0.0.0 DATA_FILE=/path/to/app-data.json node server/server.mjs
```

本机路径继续使用原来的 JSON 数据文件、scrypt 密码哈希和 `data/backups/` 每日备份。

运行测试：

```bash
npm test
```

完整的 Worker 测试需要 Node.js 22.5 以上（使用内置的 `node:sqlite` 模拟 D1）；更低版本会自动跳过 Worker 部分，本机 Node 服务的测试仍会运行。

## Cloudflare 免费档部署（Workers + D1）

代码、配置、D1 迁移和本地验证已经准备好，但**没有由本机登录或发布**。发布由已授权的免费 Cloudflare 账号执行：

```bash
npm ci
npx wrangler login          # 由布置方执行；本仓库脚本不会代替登录
npm run cf:release          # 构建 -> 查找/创建免费 D1 -> 迁移 -> 部署到 workers.dev
```

预期地址形态：`https://yanyu-cishu.<你的 workers.dev 子域>.workers.dev/`。

不使用域名、Workers Paid、Durable Objects、R2 或任何付费绑定。完整说明、0 元额度、已知限制和发布检查表见：

- `docs/CF-DEPLOY-acceptance.md`
- 自动检查：`npm run cf:check`
- 本地 Worker 预览：`npm run cf:dev`（使用 `.wrangler/state` 里的本地 D1）

## 结构

```text
public/          浏览器端页面、样式、PWA、Service Worker、静态响应头
shared/          前后端共用的初始词库、数据变更逻辑、间隔重复、统计、账号校验
server/          Node 原生 HTTP 服务、账号、同步接口、JSON 持久化
worker/          Cloudflare Worker 入口、API、D1 存储、PBKDF2 会话
migrations/      D1 建表迁移（线上空库开始）
scripts/         静态资源构建、Pages 构建与冒烟、Cloudflare 免费档发布脚本
dist/            Cloudflare 静态资源构建产物（gitignore，只含 public + shared）
pages-dist/      GitHub Pages 构建产物（gitignore，本机模式）
data/            本机运行时数据与每日备份（gitignore，绝不上传）
docs/            任务书、V1 验收说明、Cloudflare 与 GitHub Pages 验收说明
tests/           Node 内置测试 + Worker/D1 模拟测试 + Pages 构建测试
```

## 账号与数据

- 用户名 + 密码注册登录，不保存明文；本机 Node 用 scrypt，Cloudflare Worker 用免费档可承受的 PBKDF2-HMAC-SHA256（50,000 次迭代）。
- 每个用户首次注册时复制一份初始词库（60 条、4 个易混组），之后完全独立。
- 学习记录采用“本机先写、联网补传”的方式；同一账号可在不同设备登录。
- 浏览器端使用 IndexedDB 保存离线快照与待补传记录，应用外壳由 Service Worker 缓存。
- 本机服务端数据写入 `data/app-data.json`，写盘前每日保留一份 `data/backups/app-data-YYYY-MM-DD.json`。
- Cloudflare 线上数据存入 D1：用户、会话、每人一份状态 JSON；线上从空库开始，不迁移本机数据。
- 删除词语/分组/错词为软删除，学习历史保留。

## 发布说明

V1 的历史验收记录见 `docs/V1-acceptance.md`。Cloudflare 免费档的当前交付状态、发布命令和限制见 `docs/CF-DEPLOY-acceptance.md`。GitHub Pages 静态版的公网地址、数据方式和已知限制见 `docs/PAGES-acceptance.md`。本轮没有购买域名、没有开通付费套餐、没有绑定银行卡、没有把本机数据写进部署包。
