# 言语词库 · GitHub Pages 静态版验收说明

> 交付对象：文轩  
> 任务：`DSH-TASK-PAGES`（2026-11-10）  
> 项目目录：`/workspace/dsh-projects/yanyu-cishu/`  
> 结论：**已发布到免费 GitHub Pages，公网 HTTPS 地址可用；不用登录，词库和进度只保存在每个人自己的浏览器里。**

---

## 一、可直接使用的地址

### https://3466556309-debug.github.io/yanyu-cishu/

打开就是言语词库首页，不需要注册、登录，也不请求后台接口。

| 项目 | 内容 |
|---|---|
| 公网地址 | https://3466556309-debug.github.io/yanyu-cishu/ |
| GitHub 仓库 | https://github.com/3466556309-debug/yanyu-cishu |
| 仓库可见性 | 公开（Public） |
| 托管方式 | GitHub Pages，免费公开仓库，`gh-pages` 分支根目录 |
| 自定义域名 | 无；使用 `github.io` 免费子域名 |
| HTTPS | 已开启 |
| 费用 | **0 元**：没有买域名、没有开通付费套餐、没有绑卡、没有购买服务器或数据库 |
| 账号要求 | 使用本站不需要 GitHub 账号，也不需要任何账号 |

GitHub Pages 的构建来源：

```text
分支：gh-pages
目录：/（根目录）
地址：https://3466556309-debug.github.io/yanyu-cishu/
```

---

## 二、这个版本怎么存数据

### 2.1 只存在当前浏览器

- 词库、学习进度、错词本、打卡和设置都保存在**当前浏览器**的 IndexedDB 里。
- 数据库名：`yanyu-cishu`；本机词库快照键：`snapshot:local-user`。
- 第一次打开时，自动把一份初始高频词（60 个词、4 个易混组）复制进这份本机词库；之后增删改只改这一份。
- 没有总词库、公共词库，也没有服务器数据库。导入的词只进自己的浏览器，别人看不到。
- 页面不调用注册、登录、同步、改密码等接口；静态版里这些入口已经隐藏。

### 2.2 刷新和重开

- 正常刷新、关掉标签页再打开，词库和进度仍在。
- 换手机、换电脑、换浏览器，进度**不会**自动跟过去；这是本次拍板接受的限制。
- 清理浏览器缓存/网站数据、使用无痕窗口，或者换一个浏览器配置，本机词库可能被清掉。重要内容请在“设置 → 本机数据 → 下载备份”留一份 JSON。
- 本站没有“一键清空”按钮；删除词语、分组、错词都是软删除，学习历史仍保留。

### 2.3 离线（PWA）

- 页面注册了 Service Worker，应用外壳会缓存在浏览器里。
- 公网验收时已确认 Service Worker 处于 `activated`，缓存名为 `yanyu-cishu-v2-20261110-1`，作用域是 `https://3466556309-debug.github.io/yanyu-cishu/`。
- 打开过一次后，断网通常仍可继续打开和练习；首次打开仍需要联网。
- 离线只保证“这台设备还能用”，不改变“不跨设备同步”的限制。

---

## 三、Pages 版与 Cloudflare 登录版的区别

| 对比项 | GitHub Pages 静态版（本页） | Cloudflare Workers + D1 登录版 |
|---|---|---|
| 地址 | `https://3466556309-debug.github.io/yanyu-cishu/` | 由 Cloudflare 账号决定，形如 `https://yanyu-cishu.<子域>.workers.dev/` |
| 是否需要登录 | 不需要 | 需要用户名 + 密码 |
| 数据存在哪里 | 每个人自己的浏览器 IndexedDB | Cloudflare D1 中每个账号一份状态 |
| 跨设备同步 | 不支持 | 支持同一账号登录后同步 |
| 导入词表 | 只进本机词库 | 只进自己的账号词库 |
| 离线 | 支持应用外壳缓存和本机继续学 | 支持离线暂存，联网补传 |
| 后台接口 | 无 | Workers API |
| 费用 | GitHub Pages 免费额度，0 元 | Cloudflare 免费额度，0 元 |
| 适用场景 | 打开就能用、不登录、各自保存 | 需要换设备接着学、接受登录 |

两套版本并存、互不影响：

- 本轮没有改动、拆除或重新部署已有的 Cloudflare Workers/D1 配置。
- 本机 Node 服务 `node server/server.mjs` 及其账号、JSON 数据、备份逻辑都保留。
- Pages 静态版与“公考错题本”相互独立，不共用账号、数据或页面。

---

## 四、功能保留情况

除“登录 / 换设备同步”按任务书取消外，V1 的学习能力保留：

- 第一次打开自动复制初始高频词：60 个（成语 32、实词 28）、4 个十词易混组。
- 今日新学 + 到期复习；每日新学默认上限 20，可改。
- 到期复习可切换“当天清完”或“可以留到后面”。
- 成语和实词可分开练或混合练。
- 练习方式二选一：
  - “先想再揭晓”：揭晓后自评认识/模糊/忘记、默写、选择近义项。
  - “句中选词”：在句子里选词，选项放易混词。
- 易混组成组对比；预置 4 组，也可自建、编辑、删除。
- 错词本、每日打卡、连续学习天数、待复习数、7 天/28 天统计。
- 词库增删改、导入 CSV/TXT/TSV/JSON 或粘贴内容；同类型字面完全一样才算冲突，只跳过冲突条目。
- 导出本机备份 JSON（不含密码，因为静态版没有密码）。
- 手机/平板/电脑响应式布局；可添加到主屏幕。

静态版不包含：注册登录、密码修改、退出账号、跨设备同步、服务端恢复账号。这些属于 Cloudflare 登录版。

---

## 五、发布过程与 0 元约束

### 5.1 做了什么

1. 在现有项目里增加静态本机模式（`public/js/mode.js`），源码默认仍是 `server`，只在 Pages 构建产物里切成 `local`，因此不影响 Node / Cloudflare。
2. 把页面、JS 模块、Service Worker、manifest 的资源路径改成相对路径，适配项目站前缀 `/yanyu-cishu/`。
3. 新增 Pages 构建脚本 `scripts/build-pages.mjs`：只复制 `public/` 和 `shared/`，写入本机模式、`.nojekyll` 和 `404.html`，不复制 `data/`、`server/`、`worker/`、`migrations/`。
4. 用已登录的 GitHub 账号 `3466556309-debug` 创建公开仓库 `yanyu-cishu`，推送源码到 `master`。
5. 把 Pages 构建产物推到 `gh-pages` 分支根目录，GitHub Pages 构建成功。
6. 用公网地址做 HTTP 资源检查和真实 Chrome 主路径检查。

### 5.2 没有做/没有花钱

- 没有购买域名、没有绑定银行卡、没有开通任何付费套餐。
- 没有创建 Cloudflare 付费资源，没有改已有 Cloudflare 部署。
- 没有把 `data/app-data.json`、`data/backups/`、`.env`、密钥、`.wrangler/`、`node_modules/` 上传到 GitHub。
- 没有上传任何本机用户数据；公开仓库里只有源码、初始词库和静态页面。
- 没有改“公考错题本”仓库。
- 过程没有逐步打扰文轩。

### 5.3 如何重新发布（给维护者）

```bash
# 1) 构建静态站
npm run pages:build

# 2) 把 pages-dist/ 推到 gh-pages 分支根目录
#    可以用临时目录，避免污染当前工作区
mkdir -p /tmp/yanyu-pages && cp -a pages-dist/. /tmp/yanyu-pages/
cd /tmp/yanyu-pages
git init -b gh-pages
git add -A && git commit -m "发布言语词库静态站"
git remote add origin https://github.com/3466556309-debug/yanyu-cishu.git
git push --force origin gh-pages

# 3) 等 GitHub Pages 构建完成，再打开公网地址抽查
```

注意：`gh-pages` 分支是构建产物，源码改动要提交到 `master`，再重新构建发布。

---

## 六、验收记录

### 6.1 公网资源检查（2026-11-10）

以下地址均返回 HTTP 200：

| 资源 | 结果 |
|---|---|
| 首页 `/yanyu-cishu/` | 200，`text/html` |
| `/css/app.css` | 200，`text/css` |
| `/js/app.js` | 200，`application/javascript` |
| `/js/mode.js` | 200，内容为 `APP_MODE = 'local'` |
| `/shared/seed.mjs` | 200，初始词库模块 |
| `/manifest.webmanifest` | 200，`application/manifest+json` |
| `/icons/icon-192.png` | 200，`image/png` |
| `/sw.js` | 200，Service Worker |

### 6.2 真实浏览器主路径（公网 HTTPS）

使用本机 Google Chrome 无头浏览器，打开公网地址 `https://3466556309-debug.github.io/yanyu-cishu/`：

- 首页正常显示，**没有登录表单**，显示“开始今日学习”。
- 状态标记为“已存在本机”，本机模式生效。
- IndexedDB 初始词库 60 个词。
- 点击“开始今日学习”能进入练习；揭晓、自评、默写、近义项、下一词均可操作。
- 完成一个词后，学习记录写入 IndexedDB：打卡 1 条、已学 1 个词。
- 刷新后学习记录仍在。
- 在“我的词库”添加“本机测试词”，刷新后仍在；词库变为 61 个词。
- Service Worker 已激活，PWA 缓存存在。
- 页面控制台无异常。

自动化测试：`npm test` 共 31 项全部通过，其中包括新增的 Pages 构建/路径/本机状态测试；原 Node 服务与 Worker 测试保持通过。

复测命令：

```bash
# 本机构建 + 用 /yanyu-cishu/ 前缀模拟项目站
npm run pages:build
node scripts/smoke-pages.mjs --dir pages-dist /yanyu-cishu/

# 公网复测（需要本机有 Chrome）
node scripts/smoke-pages.mjs https://3466556309-debug.github.io/yanyu-cishu/
```

---

## 七、已知限制

1. **数据只在各自浏览器里。** 换设备、换浏览器不会自动同步；清理浏览器网站数据会丢失本机词库。建议偶尔下载备份。
2. **没有账号和登录。** 因此也没有“忘记密码找回”“账号云备份”“多设备冲突合并”。
3. **`github.io` 在部分学校、单位或网络环境下可能打不开。** 这是 GitHub Pages 的常见网络限制，不是页面代码问题；遇到时只能换网络，或使用已有的 Cloudflare 登录版地址。
4. **首次打开需要联网。** 之后依靠 Service Worker 缓存，尽量离线可用；首次从未打开过的设备无法离线启动。
5. **静态版没有“导入整份备份”的入口。** 备份 JSON 可以下载留底，但恢复整份备份不在本次最小可交范围内。
6. **修改后需要重新发布。** GitHub Pages 是静态托管，源码更新后要重新构建并推 `gh-pages`，公网才会变化。
7. **公开仓库暴露源码和初始词库。** 这是免费 GitHub Pages 的前提；里面没有用户数据、密码或密钥。
8. **GitHub Pages 免费额度与政策可能变化。** 本轮发布时是免费公开仓库，未绑定任何付费项。

---

## 八、最小可交对照

| 任务要求 | 结果 |
|---|---|
| 站点已上线，给出完整公网 HTTPS 地址 | 已完成：https://3466556309-debug.github.io/yanyu-cishu/ |
| 打开即首页，不用登录 | 已完成 |
| 静态资源可加载 | 已完成：HTML/CSS/JS/图标/种子模块/SW 均 200 |
| 主路径可走通 | 已完成：初始化 60 词 → 进入练习 → 记录进度 → 刷新保留 → 添加词并保留 |
| 词和进度只存在各自浏览器 | 已完成：IndexedDB，无后台接口 |
| 公开 GitHub 仓库 + Pages | 已完成：https://github.com/3466556309-debug/yanyu-cishu |
| 0 元 | 已完成：免费公开仓库 + GitHub Pages，无域名/无付费/无绑卡 |
| 不传 `data/app-data.json` | 已完成：构建和仓库均未包含 |
| 不改公考错题本 | 已完成：未触碰 |
| 不拆 Cloudflare 部署 / 保留 Node 服务 | 已完成：未改动相关配置与代码路径 |
| 验收文档 | 本文件 |
