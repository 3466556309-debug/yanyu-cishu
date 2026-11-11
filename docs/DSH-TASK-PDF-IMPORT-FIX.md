# DSH-TASK-PDF-IMPORT-FIX：修好文轩这份 PDF 的导入，并改正误导提示

下达：文轩经 DSH云端官 · 2026-11-11
执行方：dsh（本 bot 只布置与抽查，不写业务代码）
工作目录：`/workspace/dsh-projects/yanyu-cishu/`（不要另起项目，不要改公考错题本）

## 背景

文轩在 iPad 的 Safari 打开 GitHub 网页版 https://3466556309-debug.github.io/yanyu-cishu/ ，从「我的词库 → 导入词表」选择「高频800词记忆版（绿色底图）.pdf」，页面提示：

> 这个 PDF 打不开，可能已经损坏或不是真正的 PDF。

这份文件**没有损坏，也是真正的 PDF**。本地用 pdfinfo / pdftotext / 本仓库的 `public/vendor/pdfjs` 都能打开：PDF 1.3，28 页，A4，未加密，由 iOS 16.6.1 Quartz PDFContext 生成（约 948KB），正文是「花生十三 800词」讲义，多列表格（成语大类 / 成语小类 / 成语 / 解释），可抽出大量汉字。

用户原件（只作本机对照，禁止提交到公开仓库）：

- `/workspace/dsh-projects/yanyu-cishu/.tmp-user-pdf/高频800词记忆版（绿色底图）.pdf`
- 只读备份：`/home/box/agent-data/agents/a739952d-6ee2-487d-8e22-71f3d256a8b4/attachments/b60da7b1a110e8d23eded4b213f0964542d2b1f9f48d02c1fbe13cd22671fa8f.pdf`

目录 `.tmp-user-pdf/` 已写入 `.gitignore`。不要把这份讲义提交、推送或写进 pages-dist。

当前代码在 `public/js/import-files.js` 的 `parsePdf`：`getDocument` 一失败就抛出上面这句「损坏或不是真正的 PDF」。公网冒烟当时只在 Chrome 里测过小夹具，没有在 Safari / iPad 上测过这份真文件。最大可能是 iPad Safari 上 PDF.js worker（`pdf.worker.min.mjs` 模块 worker）失败，被误报成文件损坏。另外即使用 `pdftotext -layout` 得到正文后走现有抽词，也会抽出大量错词（如「大类」「5个」「中华文明传统」），讲义表格没有被正确识别。

## 目标

1. **这份 PDF 在 iPad Safari 和常见电脑浏览器里都能打开并进入预览**，不再弹出「损坏或不是真正的 PDF」。
2. **提示要符合事实**：文件无效、加了密码、解析部件/Worker 没加载成功、或只是版面抽词失败，要分开说，并用白话告诉下一步（刷新、另存一份普通 PDF、截图按图片导入等）。不要再把打开失败一律说成文件坏了。
3. **抽词要能用于这份「词语 + 解释」多列表格讲义**：预览里应主要是真正的成语/实词及其释义（如「源远流长」「博大精深」），不要把「第一组」「5个」「大类」「更多免费考公资料…」大批量当成词条。分类小标题没有释义的，继续放进跳过并说明原因。预览仍可改、可删，确认后才写入。冲突规则不变。
4. 原有 CSV/TXT/Excel/Word/图片/粘贴不要回退；现有测试不要无故变红。

## 硬约束

- **0 元**：不买服务、不绑卡、不用付费识别接口；解析仍在浏览器本地完成。
- 不删用户数据；不提交 `data/app-data.json`、密钥、`.env`、`.wrangler/`、`node_modules/`、用户这份 PDF。
- 不要改公考错题本；不要拆除已上线的 Cloudflare 登录版。Cloudflare 前端仅在现有免费授权、不必再登录且 0 元时一并更新，否则跳过并写进验收说明。
- 不扩范围：不要做「任何文件都能导入」，不要改练习/登录/同步。
- 注意 GitHub 项目站路径前缀 `/yanyu-cishu/`。若必须再授权或必须花钱，立刻停下写进验收文档并结束本轮。

## 技术要求（方向，具体实现由你定）

- 先对准这份用户 PDF 复现并修好「打不开」。优先考虑 iPad / Safari 下 PDF.js worker 失败时的回退（例如 Worker 失败后改在页面主线程解析），并在电脑 Chrome 上回归。
- 用这份 PDF 的版面（多列：成语/词语 + 解释）改进抽取；可用 pdf.js 的文字坐标还原表格。做一组**不含用户原件**的自动测试夹具（自己构造的小表格 PDF 即可），覆盖「多列表格讲义」抽词。
- 本地可用用户 PDF 做冒烟（打开成功、预览词条质量明显好于现在的错抽），但验收文档不要粘贴讲义全文，也不要把该文件发到仓库或公网。
- 测试通过后推送更新 GitHub Pages（https://3466556309-debug.github.io/yanyu-cishu/ ）。用公网地址抽查导入入口与 PDF.js 资源不是 404。

## 最小可交（做到即停）

1. 用户这份 PDF 在修复后的站点上可以打开并生成可用预览（成语/实词 + 释义为主）；iPad Safari 这一侧要作为必须覆盖的情况（可用说明 + 代码回退保证，若本机没有 iPad，至少做 Safari 或 WebKit 能测的路径，并写明验证范围）。
2. 「损坏或不是真正的 PDF」不再误用于这种能打开的文件。
3. 自动测试通过；写 `docs/PDF-IMPORT-FIX-acceptance.md`（原因、改了什么、已知限制、0 元、未提交用户 PDF、Pages 是否已更新）。
4. 给出已更新的 HTTPS 地址。

完成后退出会话。过程不逐步报文轩。
