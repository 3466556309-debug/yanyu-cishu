# 言语词库 V1 · Cloudflare Workers + D1 免费档验收说明

> 交付对象：文轩  
> 任务：`DSH-TASK-CF-DEPLOY`（2026-11-10）  
> 工作目录：`/workspace/dsh-projects/yanyu-cishu/`  
> 结论：**代码、配置、D1 迁移、自动化测试、本机 `wrangler dev` 主路径均已完成；公网发布未执行。** 发布动作留给布置方用已授权的免费 Cloudflare 账号执行，预期地址为 `https://yanyu-cishu.<子域>.workers.dev/`。

---

## 一、交付结论与当前状态

### 1.1 已完成

- 可在 Workers 免费档运行的 Worker 入口、API、会话与 D1 存储。
- D1 建表迁移：用户、会话；每个用户一份状态 JSON（词库、进度、错题、打卡、设置）。
- 前端静态资源部署包：`public/` + 前端请求的 `/shared/*.mjs`。
- 本机 Node 路径 `node server/server.mjs` 保留，原测试仍通过。
- 自动化测试 28 项全部通过，覆盖 Worker 的注册、登录、同步、用户隔离、密码修改、会话过期、参数校验、PBKDF2。
- 本机 `wrangler dev` 已实际走通：健康检查、静态页面、`/shared/*.mjs`、`/sw.js`、注册、登录、同步、重复同步、用户隔离、修改密码、退出登录。
- `wrangler deploy --dry-run` 已通过（未上传）。
- 0 元约束检查：没有购买域名、没有开通 Workers Paid、没有绑定银行卡、没有申请 API Token、没有执行 `wrangler login`、没有向 Cloudflare 写入用户数据。

### 1.2 尚未完成（需要布置方执行）

- 没有公网地址。发布需要已授权的免费 Cloudflare 账号在本机登录后运行发布脚本。
- 发布后需要做一次公网冒烟测试（健康检查、注册、登录、同步）。
- 发布后需要在 Cloudflare 控制台确认仍在 Free 计划、没有产生付费资源。

### 1.3 预期公网地址形态

```text
https://yanyu-cishu.<你的 workers.dev 子域>.workers.dev/
```

`<你的 workers.dev 子域>` 由 Cloudflare 账号决定，`wrangler deploy` 成功后也会直接打印实际地址。没有购买域名，也不会绑定自定义域名。

---

## 二、交付文件清单

| 用途 | 路径 |
|---|---|
| Worker 入口 | `worker/index.mjs` |
| API 路由与业务处理 | `worker/app.mjs` |
| D1 数据访问、乐观并发同步 | `worker/store.mjs` |
| PBKDF2 密码、会话令牌 | `worker/auth.mjs` |
| 请求体、错误、校验、响应头 | `worker/http.mjs` |
| Wrangler 配置 | `wrangler.toml` |
| D1 迁移 | `migrations/0001_init.sql` |
| 静态资源构建（public + shared） | `scripts/build-cf-assets.mjs` |
| 免费档发布脚本 | `scripts/cf-release.mjs` |
| 静态响应头（CSP、缓存、SW） | `public/_headers` |
| 账号字段共用规则 | `shared/auth-rules.mjs` |
| Worker 测试 | `tests/worker.test.mjs`、`tests/helpers/d1-shim.mjs` |
| 配置/0 元约束测试 | `tests/cf-config.test.mjs` |
| 本验收文档 | `docs/CF-DEPLOY-acceptance.md` |

关键配置值：

| 项目 | 值 |
|---|---|
| Worker 名称 | `yanyu-cishu` |
| D1 名称 | `yanyu-cishu` |
| D1 绑定名 | `DB` |
| 静态资源绑定名 | `ASSETS` |
| 静态资源目录 | `./dist`（由 `npm run cf:build` 生成） |
| 迁移目录 | `migrations/`，文件 `0001_init.sql` |
| 兼容日期 | `2026-10-01` |
| 发布平台 | 免费 Workers + D1 + `workers.dev` |
| 付费功能 | 无 Durable Objects、R2、Queues、自定义域名、Workers Paid |

`wrangler.toml` 里的 `database_id` 是占位值；发布脚本会在首次发布时查找或创建免费 D1，并把真实 ID 写回配置。**它不是密钥，也不是账号凭据。**

---

## 三、实现说明

### 3.1 路由与静态资源

- `wrangler.toml` 使用 `run_worker_first = ["/api/*"]`：API 请求先进入 Worker；其余路径直接由 Workers 静态资源返回。
- 静态资源目录为 `dist/`，构建脚本只复制两处：
  - `public/` 的页面、样式、脚本、图标、`sw.js`、`manifest.webmanifest`、`_headers`；
  - `shared/` 到 `dist/shared/`，因此浏览器请求的 `/shared/reducer.mjs`、`/shared/schedule.mjs`、`/shared/selectors.mjs` 可正常加载。
- `not_found_handling = "single-page-application"`：非 API 的未知路径回退到 `index.html`，保持 V1 单页行为。
- `public/_headers` 统一加 CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`；`sw.js`、`index.html` 为 `no-cache`；`/shared/*` 允许 1 小时缓存。Worker 对静态响应还会兜底补安全头。
- 没有修改前端 API 路径，也没有改登录方式或同步语义。仅把 Service Worker 缓存版本从 `yanyu-cishu-v1-20261110-3` 提升到 `-4`，避免新部署继续使用旧外壳缓存。

### 3.2 API 兼容性

Worker 与现有 `public/js/api.js`、`server/server.mjs` 的请求/响应字段保持一致：

| 接口 | 成功响应 | 主要失败文案 |
|---|---|---|
| `GET /api/health` | `200 {"ok":true,"time":"..."}` | 无 |
| `POST /api/register` | `201 {"ok":true,token,user,revision,state}` | `用户名请填写 2—24 个字`；`密码至少 6 位`；`这个用户名已经有人用了，请换一个`（409） |
| `POST /api/login` | `200 {"ok":true,token,user,revision,state}` | `用户名或密码不对，请再试一次`（401）；`尝试次数太多，请过一会儿再试`（429） |
| `POST /api/logout` | `200 {"ok":true}` | `请先登录` / `登录已过期，请重新登录`（401） |
| `POST /api/password` | `200 {"ok":true,"message":"密码已经改好"}` | `现在的密码不对`（400）；新密码校验文案同上 |
| `POST /api/sync` | `200 {"ok":true,...}`，与 Node 版一致的 `notModified`、`revision`、`state`、`applied`、`duplicates`、`skipped`、`serverTime` | `学习记录格式不正确`、`学习记录编号不正确`、`学习记录类型不正确`、`学习记录时间不正确`、`学习记录内容不正确`；超过 1500 条为 413；超过 2MB 为 `提交内容太大` |

其他兼容点：

- Bearer 会话，格式 `Authorization: Bearer <token>`；令牌 32 字节随机数，base64url。
- 会话有效期 365 天；与 Node 版一致。
- 每个用户注册时获得 `createSeedState()` 的 60 词、4 个易混组副本，之后按用户隔离。
- 删除/分组/错词等仍通过 `shared/reducer.mjs` 的 `applyOps` 执行，客户端与服务端共用同一套操作语义。
- 注册、登录、同步、修改密码的字段与前端 `public/js/api.js` 不冲突。

### 3.3 D1 数据模型

`migrations/0001_init.sql` 只建两张表，不写入任何用户数据：

```sql
users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  norm_username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state_json TEXT NOT NULL,      -- 该用户完整的一份状态 JSON
  revision INTEGER NOT NULL DEFAULT 1,
  seen_ops_json TEXT NOT NULL DEFAULT '[]'
)

sessions (
  token_hash TEXT PRIMARY KEY,   -- 只存令牌的 SHA-256，不存明文令牌
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)
```

- 用户隔离：所有需要登录的接口只从 Bearer 会话取 `user_id`，不接受客户端传入的用户 ID。
- 注册：`users` 插入与 `sessions` 插入放在同一个 D1 `batch` 事务里；用户名唯一约束兜底并发注册。
- 同步：读当前 `revision`，用 `UPDATE ... WHERE id = ? AND revision = ?` 做乐观并发；被另一台设备抢先时重新读取并合并后重试，最多 5 次。这样两台设备同时写不会互相覆盖。
- 幂等：`seen_ops_json` 保存已处理操作 ID（上限 10,000 条），重复提交只计 `duplicates`，不重复应用。
- 登录时顺带删除已过期的会话；过期会话访问时也会被删除。

### 3.4 密码与会话

- Worker 使用 **PBKDF2-HMAC-SHA256，50,000 次迭代**，16 字节随机盐，32 字节输出，格式：

  ```text
  pbkdf2$50000$<salt-hex>$<hash-hex>
  ```

- 不使用 scrypt：scrypt 在 Workers 免费档 10ms CPU 限制下风险高，且 Workers 运行时默认没有 Node `crypto.scrypt`。PBKDF2 由 Web Crypto 执行，更适合免费档。
- 本机 Node 路径继续使用原有 scrypt，不改本机已有密码哈希；线上 D1 是空库，不需要兼容 scrypt。
- 令牌只把 SHA-256 哈希写入 D1；数据库泄露不会直接得到可用的 Bearer 令牌。
- 修改密码会删除该用户除当前会话外的其他会话；当前设备继续可用，与 Node 版一致。
- 没有 PEPPER（额外密钥）。这样部署不需要再生成/保管一个密钥，避免“密钥丢失导致所有用户无法登录”；代价是密码哈希强度低于带 pepper 的方案，见已知限制。

### 3.5 本机 Node 路径

- `node server/server.mjs` 的启动方式、端口、`DATA_FILE`、JSON 持久化、scrypt、每日备份均未拆掉。
- 只把用户名/密码的纯校验函数抽到 `shared/auth-rules.mjs`，Node 和 Worker 共用，保证提示文案一致；`server/auth.mjs` 继续导出同名函数，现有导入不需要改。
- 原有 13 项 Node 测试全部通过。

---

## 四、如何发布（由布置方执行）

### 4.1 前置条件

- Node.js 20 以上（本机验证使用 Node 24.22.1）。
- 一个已授权的 **免费** Cloudflare 账号；布置方已有登录态或自行执行登录。
- 不需要 API Token；不需要绑定银行卡；不需要购买域名。
- 本机 `data/app-data.json` 不会被使用，也不会被上传。

### 4.2 一条命令发布（推荐）

在项目目录执行：

```bash
cd /workspace/dsh-projects/yanyu-cishu
npm ci
npx wrangler login        # 由布置方执行；本仓库脚本不会代替登录
npm run cf:release
```

`npm run cf:release` 会依次：

1. 构建 `dist/`（只含 `public/` + `shared/`，并检查不含 `data/`、`app-data.json`）。
2. 执行 `wrangler whoami` 检查登录态；**未登录就停止**，不会自动登录。
3. 查找名为 `yanyu-cishu` 的 D1；没有则执行 `wrangler d1 create yanyu-cishu --location apac`（免费档），并把 `database_id` 写回 `wrangler.toml`。
4. 执行 `wrangler d1 migrations apply yanyu-cishu --remote`，只建表，不写用户数据。
5. 执行 `wrangler deploy`，发布 Worker `yanyu-cishu` 到 `workers.dev`。

脚本不会打开付费开通页，不会升级套餐，不会申请 Token。遇到需要付费或额外授权的提示会失败退出。

**首次发布前请确认：** 账号里没有同名的、但不是本项目的 Worker 或 D1 `yanyu-cishu`。如果已有同名资源，先人工确认用途，避免覆盖别的 Worker 或把建表迁移写进错误的数据库。

### 4.3 手动发布（脚本不适用时）

```bash
cd /workspace/dsh-projects/yanyu-cishu
npm ci
npx wrangler login

# 1) 创建免费 D1（如果已有 yanyu-cishu，跳过）
npx wrangler d1 create yanyu-cishu --location apac
# 把输出里的 database_id 填入 wrangler.toml 的 [[d1_databases]] 段

# 2) 构建静态资源
npm run cf:build

# 3) 应用迁移（只建表）
npx wrangler d1 migrations apply yanyu-cishu --remote

# 4) 发布
npx wrangler deploy
```

发布前可用 `npm run cf:check` 做不联网检查；用 `npx wrangler deploy --dry-run` 做不上传的构建检查。

### 4.4 发布后冒烟测试

把下面的 `<子域>` 换成实际地址：

```bash
curl -sS https://yanyu-cishu.<子域>.workers.dev/api/health
# 预期：{"ok":true,"time":"..."}
```

浏览器检查：

1. 打开 `https://yanyu-cishu.<子域>.workers.dev/`，页面、样式、图标正常。
2. 注册一个新账号，进入后应看到 60 个词、4 个易混组。
3. 新增一个词，等右上角显示“已保存”。
4. 换一个浏览器/无痕窗口，用同一账号登录，能看到新增词。
5. 断网后刷新（Service Worker 已控制页面时）应能打开离线外壳；恢复网络后自动补传。
6. 打开 `https://yanyu-cishu.<子域>.workers.dev/shared/selectors.mjs`，应返回 JavaScript，而不是 HTML 或 404。
7. 打开 `https://yanyu-cishu.<子域>.workers.dev/sw.js`，应返回 JavaScript，响应头含 `Cache-Control: no-cache`。

### 4.5 0 元确认

发布后在 Cloudflare 控制台确认：

- Workers & Pages 里只有 Free 计划，没有 Workers Paid。
- D1 只有免费数据库 `yanyu-cishu`，没有付费数据库/超额存储。
- 没有 R2、Durable Objects、Queues、自定义域名、付费订阅。
- 没有绑定银行卡或产生账单。

如果控制台提示需要升级、绑卡或购买才能继续，**立即停止**，不要确认，把提示截图/文字记录下来交给文轩。

---

## 五、本地验证记录

### 5.1 自动化测试

命令：

```bash
npm test
```

结果：**28 项通过，0 失败**（本机 Node v24.22.1）。包括：

> 在 Node 22.5 以下的机器上，Worker 测试会自动跳过（因为缺少内置 `node:sqlite`），本机 Node 服务和其余测试仍会运行；完整验证建议使用 Node 22.5+。

- 原有 Node 测试：初始词库、间隔重复、错题、每日上限、导入冲突、账号隔离、同步幂等、密码、落盘不含明文密码。
- Worker 测试：健康检查/静态资源、注册、校验文案、用户名冲突、登录、365 天会话、退出、同步、幂等、未修改、跨用户隔离、冲突跳过、并发写、修改密码、过期会话、同步参数校验、PBKDF2。
- 配置测试：`wrangler.toml` 只用免费 Workers + D1 + `workers.dev`；迁移只建表；CSP/Service Worker 响应头；发布脚本不自动登录、不申请 Token。

### 5.2 配置与构建检查

```bash
npm run cf:check
```

结果：通过。`dist/` 共 24 个文件、约 301.6 KB，包含 `/shared/*.mjs`，不含 `data/` 或 `app-data.json`。

```bash
npx wrangler deploy --dry-run
```

结果：通过，未上传。Worker 包大小约 73.57 KiB（gzip 18.51 KiB），识别到绑定：

```text
env.DB (yanyu-cishu)   D1 Database
env.ASSETS             Assets
```

### 5.3 本地 D1 迁移

```bash
CI=1 npx wrangler d1 migrations apply yanyu-cishu --local
```

结果：本地 D1 执行 5 条命令成功，`0001_init.sql` 状态为已应用。数据只落在 `.wrangler/state/`（已 gitignore），不是远程 D1。

### 5.4 `wrangler dev` 主路径实测

本地启动：

```bash
npx wrangler dev --port 8787 --ip 127.0.0.1
```

实测结果：

| 检查 | 结果 |
|---|---|
| `GET /api/health` | `200`，`{"ok":true,"time":"..."}`，带 CSP、`Cache-Control: no-store` |
| `GET /` | `200`，`text/html; charset=utf-8`，带 CSP |
| `GET /shared/selectors.mjs` | `200`，`text/javascript; charset=utf-8`，内容含 `todayPlan` |
| `GET /sw.js` | `200`，`Cache-Control: no-cache`，`Service-Worker-Allowed: /` |
| 注册 | `201`，60 词、4 组、`revision=1` |
| 登录 | `200`，返回 token |
| 首次同步新增词 | `200`，`applied=1`，`revision=2`，状态含新词 |
| 重复提交同一操作 | `200`，`duplicates=1`，`revision=2` |
| 重新登录 | 能看到新增词（61 个词） |
| 第二个账号 | 60 个词，看不到第一个账号的新增词 |
| 错误密码 | `401`，`用户名或密码不对，请再试一次` |
| 修改密码 | `200`；旧密码 `401`；新密码 `200`；当前会话仍可用；另一会话 `401` |
| 退出登录 | `200`；退出后同步 `401` |

本机注册请求的墙钟时间约 16—71ms（中位数约 22ms），包含本地网络、D1 和 PBKDF2；**这不是 Cloudflare 免费档的 CPU 时间**，不能作为生产 10ms 限制的证明。

### 5.5 没有执行的动作

- 没有执行 `wrangler login`。
- 没有申请 API Token。
- 没有执行 `wrangler deploy`（只执行了 `--dry-run`）。
- 没有执行 `wrangler d1 create` 的远程创建；只在本地应用迁移。
- 没有向远程 D1 写入任何用户数据。
- 没有打开付费开通页、没有绑定银行卡、没有购买域名。

`npm run cf:release` 在未登录环境下的实际表现：构建完成后停在“本机 wrangler 还没有登录”的提示，没有继续执行 D1 创建或部署。这正是预期的安全停止。

---

## 六、0 元约束核对

### 6.1 使用的免费额度

参考 Cloudflare 当前公开文档（2026-11）：

| 项目 | 免费档 | 本应用预期 |
|---|---|---|
| Workers 请求 | 100,000 次/天 | 个人/小范围使用远低于此 |
| Workers CPU | 10ms/请求 | 登录/注册含 PBKDF2，已按 50k 迭代压低；见限制 |
| 静态资源请求 | 免费且不限量 | 页面、JS、CSS、图标都走静态资源 |
| D1 行读取 | 5,000,000 行/天 | 每用户每次同步读 1 行左右 |
| D1 行写入 | 100,000 行/天 | 注册 2 行；每次有效同步 1 行；登录 1 行 |
| D1 存储 | 5GB/账号；单库 500MB | 每用户状态 JSON 约 32KB 起，远低于 |
| D1 数据库数量 | 10 个/账号 | 只创建 1 个 |
| `workers.dev` | 免费 | 使用默认子域，不买域名 |

来源：Cloudflare Workers 限制/计费、D1 计费/限制公开文档（发布前可复查）：

- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/d1/platform/limits/>

### 6.2 有没有突破 0 元

**没有。**

- 没有购买域名；
- 没有开通 Workers Paid 或任何付费套餐；
- 没有绑定银行卡；
- 没有注册新的云账号；
- 没有申请 API Token；
- 没有创建 R2、Durable Objects、Queues 等付费/额外资源；
- `wrangler.toml` 中没有 `routes`、`custom_domain`、`durable_objects`、`r2_buckets`；
- 没有把任何密钥写进仓库；没有 `.dev.vars`、`.env` 或 API Token。

需要说明的是：免费额度用完后，Cloudflare 免费档通常会**拒绝请求/写入**，而不是自动扣费；但发布方仍需在控制台确认没有误开付费项。任何要求升级或绑卡的提示都应当停止并交给文轩决定。

---

## 七、本机数据未上传

- 部署包构建脚本只复制 `public/` 和 `shared/`，并在构建后检查 `dist/` 中不得出现 `app-data.json`、`data/`、`backups/`、`.tmp`、`.env`。检查失败会终止构建。
- 本次生成的 `dist/` 共 24 个文件，没有 `data/app-data.json`，没有 `data/backups/`。
- `data/app-data.json` 仍是本机原文件，修改时间未变；没有读取、改写或上传它。
- D1 迁移 `0001_init.sql` 只有 `CREATE TABLE` / `CREATE INDEX`，没有任何 `INSERT`；线上从空库开始，用户自行注册。
- 本机 Node 的 scrypt 用户数据不会迁移到线上；线上新用户使用 PBKDF2，两套数据互相独立。
- `.wrangler/state/` 中的本地测试 D1 已 gitignore，只用于本机 `wrangler dev`，不会被部署。

---

## 八、已知限制（请如实转告使用者）

1. **`workers.dev` 可能被学校/单位网络拦截。** 部分地区、校园网或公司网络会屏蔽 `*.workers.dev`，表现为打不开、超时或证书错误。上线后请在目标网络实测；如果被拦截，可先换手机热点/其他网络验证。0 元方案无法保证所有网络可达，购买域名/代理不属于本轮授权范围。
2. **免费档 CPU 只有 10ms/请求。** 登录/注册需要 PBKDF2，本轮选择 50,000 次迭代以尽量留在预算内；本机 `wrangler dev` 不执行免费档的 10ms 硬限制，因此**不能保证生产环境永不出现 1102（CPU 超限）**。若发布后频繁出现，应停止并报告，不要自行升级付费；可选的无付费处理是减少同时登录/注册、错峰使用，或后续评估更低迭代/其他算法（会改变安全权衡）。
3. **PBKDF2 50,000 次低于 OWASP 当前建议的更高迭代数。** 这是免费档 10ms 限制下的折中，且没有 PEPPER。数据库若被完整导出，离线破解成本低于高迭代方案。请使用者使用不与其它网站重复的密码；不要在本应用中填写身份证号等敏感信息。
4. **D1 免费额度有限。** 行读取 5,000,000/天、行写入 100,000/天、账号存储 5GB、单库 500MB、最多 10 个库。额度用完后会报错，不会自动转为付费。大量用户同时同步可能触发 D1 排队/限流。
5. **D1 单库是单线程的。** 并发写入会排队；本应用用乐观并发重试避免互相覆盖，但高并发时同步会变慢，极端情况下返回 409 `同步冲突，请稍后再试`，客户端下次自动同步可恢复。
6. **每用户状态是一行 JSON，D1 单行上限 2MB。** 正常 60 词 + 导入数百词不会接近；若长期导入大量词条、错词和 10,000 条操作 ID，可能接近上限。V1 没有为超大词库做分片。
7. **登录限流是“尽力而为”。** Worker isolate 之间不共享内存，限流按实例生效；换实例/分布式尝试可能绕过。V1 没有验证码，本轮未扩展功能。
8. **会话 365 天，没有设备管理。** 修改密码会踢掉其他会话；退出只注销当前令牌。没有“查看所有登录设备”功能。
9. **忘记密码不能自助找回。** V1 没有手机号/邮箱；线上同样没有。登录后可在设置里改密码；忘记只能重新注册，旧账号数据仍在但无法登录。
10. **同步不是实时协同。** 每次操作后、页面重新可见、恢复网络时以及每 45 秒尝试；两台设备同时改同一个词时，按操作到达服务端的顺序应用，后到的同字段修改会覆盖先到的。没有 CRDT/实时推送。
11. **离线重开需要 HTTPS 或 localhost。** `workers.dev` 是 HTTPS，满足 Service Worker 条件；首次打开仍需联网。Service Worker 对静态资源是 cache-first，未来部署新前端时需要提升 `public/sw.js` 的 `CACHE_NAME`（本轮已从 `-3` 提到 `-4`），否则老用户可能继续用旧缓存。
12. **没有自定义域名。** 地址固定在 `yanyu-cishu.<子域>.workers.dev`；如果账号子域变化、Worker 删除或账号不可用，地址会失效。没有购买域名，所以不能换成更好记的域名。
13. **没有管理后台/批量导出线上数据。** 用户可在设置里下载自己的备份；D1 免费档提供 7 天 Time Travel（按 Cloudflare 当前政策），但不是应用级自动备份。删除 Worker 不会自动删除 D1 数据；删除 D1 会丢失线上用户数据，需谨慎。
14. **本机 Node 与线上 Worker 的密码哈希不同。** 本机 scrypt 数据不会自动变成线上账号；线上是空库。若未来要把本机用户迁到线上，需要额外的迁移/重置密码方案，本轮未做。
15. **本机 `wrangler dev` 与生产存在差异。** 本地 D1 是本地 SQLite，CPU/网络/缓存行为与 Cloudflare 边缘不同；本地通过不等于生产 10ms 预算一定通过。
16. **界面与功能范围保持 V1。** 没有新增找回密码、邮箱、第三方登录、公共词库、管理后台、付费功能或新品牌包装。

---

## 九、发布失败或需要额外授权时怎么办

| 情况 | 处理 |
|---|---|
| `wrangler whoami` 提示未登录 | 由布置方执行 `npx wrangler login`；本脚本/本 bot 不会代替登录。 |
| 免费账号已有 10 个 D1，创建失败 | 不要升级。可先确认是否有废弃的免费 D1 可清理（确认无数据后），或改用已有 `yanyu-cishu` 的 ID；仍不行则停止并记录。 |
| 提示需要绑卡/升级/购买 | 立即停止，不确认、不绑卡；把提示交给文轩决定。 |
| 登录/注册出现 1102 CPU 超限 | 停止并记录发生时间、接口、频率；不要自行升级。可先减少并发/错峰；是否调整哈希参数需要单独评估，不能在发布时偷偷改。 |
| D1 额度用完（读/写/存储） | 等 UTC 零点重置，或清理无用数据；不要升级。 |
| 学校/单位网络打不开 `workers.dev` | 换网络（手机热点等）验证；若长期被拦截，0 元方案无法保证可达，需要文轩决定是否接受其他方案。 |
| `wrangler deploy` 报错 | 保留完整输出；不要删除 D1；不要开付费功能；按错误提示修复后重试。 |
| 发布后想回滚 Worker 代码 | 可用 `npx wrangler rollback`（以当前 Wrangler 支持为准）回到上一版本；**不要删除 D1**，否则用户数据会丢失。 |

---

## 十、验收清单

### 已由本 bot 完成

- [x] Worker 入口、API、D1 存储、PBKDF2 会话实现。
- [x] `wrangler.toml`、D1 迁移、静态资源构建、发布脚本。
- [x] 前端 `/shared/*.mjs`、`sw.js`、manifest、图标随静态资源提供。
- [x] API 字段/文案与现有前端、Node 服务兼容。
- [x] 每用户隔离；注册、登录、同步、改密、退出。
- [x] 同步幂等、乐观并发、冲突跳过。
- [x] 本机 Node 路径保留，原有测试通过。
- [x] 自动化测试 28 项通过。
- [x] `wrangler deploy --dry-run` 通过。
- [x] `wrangler dev` 本地主路径实测通过。
- [x] 0 元约束与“未上传本机数据”检查。
- [x] 本文档。

### 需要布置方在发布时完成

- [ ] 用已授权的免费账号执行 `npx wrangler login`。
- [ ] 执行 `npm run cf:release`（或手动命令）。
- [ ] 记录实际 `https://yanyu-cishu.<子域>.workers.dev/` 地址。
- [ ] 公网冒烟：`/api/health`、注册、登录、同步、第二个浏览器、离线重开。
- [ ] 控制台确认 Free 计划、无付费资源、无绑卡。
- [ ] 在目标网络（含可能的校园网）实测可达性。
- [ ] 把实际地址和冒烟结果补记到本文档或交付记录。

---

## 十一、附：本次实际执行的命令与结果摘要

```text
npm test
  -> 28 pass / 0 fail（Node v24.22.1）

npm run cf:check
  -> 通过；dist 24 files / 约 301.6 KB；无 data/app-data.json

npx wrangler deploy --dry-run
  -> 通过；73.57 KiB（gzip 18.51 KiB）；绑定 DB、ASSETS；未上传

CI=1 npx wrangler d1 migrations apply yanyu-cishu --local
  -> 0001_init.sql 应用成功（5 commands）

npx wrangler dev --port 8787 --ip 127.0.0.1
  -> health 200；/ 200；/shared/selectors.mjs 200；/sw.js 200
  -> register 201（60 词/4 组）；login 200；sync applied=1
  -> duplicate sync duplicates=1；relogin 看到 61 词
  -> 第二账号 60 词且看不到第一账号的词
  -> 改密/退出/会话失效均符合预期

npm run cf:release（未登录环境）
  -> 构建完成后停在“本机 wrangler 还没有登录”
  -> 未执行 login、未创建远程 D1、未部署
```

本机 Node 数据、`data/backups/`、`.wrangler/state/` 均未上传到 Cloudflare。
