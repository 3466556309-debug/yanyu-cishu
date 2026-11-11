# 导入讲义或词表（PDF / Excel / Word / 图片）验收说明

- 任务：`docs/DSH-TASK-IMPORT-FILES.md`
- 验收日期：2026-11-11
- 工作目录：`/workspace/dsh-projects/yanyu-cishu/`
- 源码功能提交：`5570896`（master；验收文档为后续文档提交）
- Pages 发布提交：`ec00de8`（gh-pages）
- 公网 Pages：https://3466556309-debug.github.io/yanyu-cishu/
- Cloudflare 登录版：https://yanyu-cishu.cishu-3466556309.workers.dev/（本轮**未更新**，原因见第 8 节）

## 1. 最小可交结论

「我的词库 → 导入词表」现在可以直接选：

| 格式 | 状态 | 说明 |
| --- | --- | --- |
| `.xlsx` | 可用 | 读取所有有内容的工作表，按表头或猜列识别 |
| `.xls` | 可用 | 旧 BIFF 格式，浏览器本地读 |
| `.xlsm` / `.xlsb` | 可尝试 | 解析器支持；页面文件选择器列出了 `.xlsm`，没有把它作为主推格式 |
| `.docx` | 可用 | 正文和 Word 表格都读；表格按表头规则识别 |
| `.doc` | 不支持，但不静默失败 | 白话提示“在 Word 里另存为 .docx 或 PDF”，不写入任何数据 |
| 文字型 `.pdf` | 可用 | 抽取正文；有表格时按列还原，正文和表格可一起导入 |
| 扫描件 `.pdf` | 可用（有页数上限） | 整页没文字时自动按图片识字；最多前 10 页 |
| `.jpg` / `.jpeg` / `.png` / `.webp` / `.bmp` / `.gif` | 可用 | 手机可从相册选图；本机识字 |
| `.csv` / `.txt` / `.tsv` / `.json` | 照常可用 | 原有入口保留，并补了类型推断 |
| 直接粘贴 | 照常可用 | 先“生成预览”，再“确认导入” |

所有文件都在**当前浏览器本地**读取、解析、识字；不上传文件，不请求本站接口，不调用任何付费识别服务。Pages 版只写当前浏览器的 IndexedDB；Cloudflare 登录版（将来更新时）只写当前账号。预览确认后才写入。

## 2. 预览与冲突规则

1. 选文件或粘贴后，先出现“导入预览”，写清：
   - 将导入多少条；
   - 跳过多少条，其中重复多少、不合格多少；
   - 每一条跳过的原因（词库已有、这次重复、没有释义、类型不对、词语为空等）。
2. 预览表格里可以直接改：类型、词语、释义、例句、来源、近义、干扰。
3. 每行右侧有垃圾桶，可以在确认前去掉某条。
4. 点“确认导入 X 条”才真正写入；导入后按钮变为“已导入”，不会重复提交。
5. 冲突规则没有变：只有**同一类型 + 词语字面完全一样**才算冲突；只跳过冲突的那几条，其余照常导入，**不覆盖已有词**。
6. 类型没写时：四个汉字优先当成语，其余当实词。预览里可以改。
7. 没有释义的词不强行入库，放进“跳过/不合格”并说明原因。
8. 表格按 `importer.js` 原有中英文表头别名识别（类型、词语、释义、例句、来源、近义、干扰）；没有表头时按列内容猜词语和释义，不整表丢弃。

## 3. 本地解析与识字（0 元）

第三方部件全部放进 `public/vendor/`，随站点发布，不运行时拉付费 CDN：

| 部件 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| SheetJS `xlsx.mjs` | 0.18.5 | Apache-2.0 | `.xlsx` / `.xls` |
| fflate | 0.8.3 | MIT | `.docx` 解压 |
| PDF.js | 4.10.38 | Apache-2.0 | PDF 文字抽取、扫描页渲染 |
| Tesseract.js | 6.0.1 | Apache-2.0 | 浏览器本地中文 OCR |
| tesseract.js-core | 6.0.0 | Apache-2.0 | OCR WASM 核心 |
| `chi_sim.traineddata.gz` | tessdata_best 4.0.0（`best_int`） | Apache-2.0 | 简体中文识别数据 |

- 版本、来源和许可证文本见 `public/vendor/README.md` 及各目录 `LICENSE*`。
- 文字解析库（Excel/Word/PDF）随 PWA 外壳预缓存，离线也能导入已经支持的格式。
- 中文识字核心和语言数据约 8 MB，第一次选图片/扫描件时才加载；之后由 Service Worker 和 Tesseract.js 的 IndexedDB 缓存在本机。
- 如果离线且还没加载过识字部件，会明确提示“先联网打开一次并识别一张图”，不会卡住或假装成功。
- **没有购买服务、没有绑卡、没有开通付费套餐、没有调用付费识别接口。**

## 4. 自动测试

### 4.1 单元/格式测试

命令：

```bash
npm test
```

结果：**41 个测试全部通过**（0 失败、0 跳过），其中新增 `tests/import-formats.test.mjs` 覆盖：

- 原有 CSV / TSV / JSON / 粘贴文本；
- 同类型同字面冲突、不同类型同字面可进；
- 无表头猜列；
- 讲义/OCR 文本抽词，没有释义的进“未能导入”；
- `.xlsx` 表头七列；
- 旧 `.xls`；
- `.docx` 表格 + 正文；
- 文字型 `.pdf` 的正文 + 表格；
- “给定 OCR 文本”的抽取逻辑；
- 夹具大小（全部小于 100 KB）。

测试夹具在 `tests/fixtures/import/`：`words.xlsx`、`words.xls`、`words.docx`、`words.pdf`、`scan.png`、`scan.pdf`、`legacy.doc`，都是小文件。

### 4.2 真实浏览器冒烟（Pages 公网）

命令：

```bash
node scripts/smoke-pages.mjs https://3466556309-debug.github.io/yanyu-cishu/
node scripts/smoke-import.mjs https://3466556309-debug.github.io/yanyu-cishu/
```

`smoke-pages.mjs` 结果：通过。初始 60 词、本机 IndexedDB、练习记录、PWA 激活、自定义词刷新后仍在，控制台无错误。

`smoke-import.mjs` 结果：通过。用真实 Chrome 在公网 Pages 上依次做了：

| 步骤 | 结果 |
| --- | --- |
| 初始词库 | 60 条 |
| Excel `.xlsx`（3 条中 2 条与初始词库冲突） | 预览 1 条，确认后 61 条 |
| 同一 Excel 再导入 | 预览 0 条，按钮不可点，未写入 |
| Word `.docx`（表格 + 正文） | 去重后预览“媲美”1 条，确认后 62 条 |
| 文字型 PDF（正文 + 表格） | 预览 4 条：鳞次栉比、踌躇、雷厉风行、一丝不苟，确认后 66 条 |
| 图片 OCR | 预览 3 条；把第一条改成“全神贯注”、去掉最后一条，确认后 68 条 |
| 扫描件 PDF | 自动 OCR，预览 1 条新词，确认后 69 条 |
| 旧 `.doc` | 显示“旧版 .doc 浏览器里打不开……另存为 .docx 或 PDF”，未写入 |
| 粘贴 | 生成预览“测试粘贴词”，确认后 70 条 |
| 断网刷新后再选图片 | 页面从 Service Worker 加载，识字部件走缓存，仍生成 2 条预览 |

控制台错误：无。

另外，本机 Pages 产物的导入冒烟是在与 Cloudflare `_headers` 相同的 CSP 下跑的（含 `worker-src 'self'`、`'wasm-unsafe-eval'`、`connect-src 'self' data:`），结果为通过；这覆盖了登录版静态资源将来直接复用的场景。

### 4.3 公网静态资源检查

发布后对以下地址逐一 `curl`，全部 **HTTP 200**：

- `/js/import-core.js`、`/js/import-files.js`、`/js/views.js`
- `/vendor/xlsx/xlsx.mjs`
- `/vendor/fflate/fflate.mjs`
- `/vendor/pdfjs/pdf.min.mjs`、`/vendor/pdfjs/pdf.worker.min.mjs`、`/vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap`
- `/vendor/tesseract/tesseract.esm.min.js`、`/vendor/tesseract/worker.min.js`
- `/vendor/tesseract/tesseract-core-simd-lstm.wasm.js`、`/vendor/tesseract/tesseract-core-simd-lstm.wasm`
- `/vendor/tesseract/lang/chi_sim.traineddata.gz`

Pages 应用外壳缓存版本已升到 `yanyu-cishu-v3-20261111-1`。已经在用的浏览器如果还开着旧页面，刷新一次即可换到新版本。

## 5. 已知限制

1. **旧 `.doc` 不支持**。浏览器里没有可靠的免费旧 Word 解析器，已用白话提示另存为 `.docx` 或 PDF，不静默失败。
2. **OCR 不是 100% 准确**。本轮生成的清晰样张 `scan.png` 中，Tesseract 把“全神贯注”认成“全利贯注”、“一点”认成“一氮”、“等待”认成“等符”、“栉”认成“梢”；扫描件 PDF 样张认出“全神贯注、迫不及待”，但“栉”仍认成“杭”。这就是预览可改、可删除的原因。模糊照片、反光、手写、竖排、艺术字会更差。
3. **扫描件 PDF 只识前 10 页**，超过会提示拆分；这是为了避免手机一次处理太久。
4. **PDF 表格列可能错位**。按文字坐标还原，复杂合并单元格、跨页表格可能需要到预览里改。
5. **单文件上限 30 MB**。特别大的扫描合集请拆分。
6. **手机 HEIC/HEIF 不保证**。页面支持常见 JPG/PNG/WebP/BMP/GIF；HEIC 能否解码取决于浏览器，失败会提示换 JPG/PNG。
7. **第一次识字需要联网加载约 8 MB 部件**；加载过一次后，本轮已实测断网刷新仍能识字。清浏览器缓存/换浏览器后需要重新加载一次。
8. **Excel 多工作表会全部读取**，跨表同类型同字面仍按冲突规则跳过。
9. 导入只影响当前使用者自己的词库；不会跨设备同步，也不会让别人看到。

## 6. 数据与安全

- 没有删除任何用户数据；导入只新增词条，重复的跳过。
- 没有提交 `data/app-data.json`、`data/backups/`、`.env`、`.wrangler/`、`node_modules/`、`dist/`、`pages-dist/` 或任何密钥。
- 页面没有写本机局域网地址。
- Cloudflare 静态资源构建 `dist/` 通过，包含相同的导入部件；`_headers` 的 CSP 已补 `'wasm-unsafe-eval'`，并允许 `connect-src data:`（Tesseract 的 WASM 核心用 data URL 加载）。本轮用与 Cloudflare 相同的 CSP 在本地跑完整导入冒烟，Excel/Word/PDF/图片/扫描件/粘贴/离线全部通过，说明将来在登录版上也能用。
- 没有改「公考错题本」仓库，没有占用或关闭它的 8080。
- 没有拆 Cloudflare 站点，没有改练习/登录/同步逻辑。

## 7. GitHub Pages 发布

- 源码已推送：`3466556309-debug/yanyu-cishu` master，提交 `5570896`。
- Pages 产物已推送到 `gh-pages`，提交 `ec00de8`。
- GitHub Pages 构建状态：`built`。
- 公网地址：**https://3466556309-debug.github.io/yanyu-cishu/**
- 已在公网完成第 4.2、4.3 节的真实浏览器冒烟和资源检查。

## 8. Cloudflare 登录版：本轮跳过

按任务要求，只有在“现有免费授权、不必再登录、0 元”时才一并更新。实际检查：

```text
$ npx wrangler whoami
You are not authenticated. Please run `wrangler login`.
```

本环境没有 `CLOUDFLARE_API_TOKEN`，也没有已登录的 Wrangler 凭据；继续发布需要重新登录/授权。因此：

- **没有执行 Cloudflare 部署**；
- **没有要求或代替任何人登录**；
- **没有开通付费、没有绑卡**；
- 现有登录版 https://yanyu-cishu.cishu-3466556309.workers.dev/ 保持原样；
- Cloudflare 构建产物 `dist/` 已验证可生成（含新导入部件），等有现成免费授权且不必再登录时可再发布。

## 9. 复现命令

```bash
# 依赖（只用于测试的 PDF.js；运行页面不需要 Node 服务）
npm ci

# 自动测试
npm test

# 构建 Pages / Cloudflare 静态资源
npm run pages:build
npm run cf:build

# 本地 Pages 前缀冒烟
node scripts/smoke-pages.mjs --dir pages-dist /yanyu-cishu/
node scripts/smoke-import.mjs --dir pages-dist /yanyu-cishu/

# 公网冒烟
node scripts/smoke-pages.mjs https://3466556309-debug.github.io/yanyu-cishu/
node scripts/smoke-import.mjs https://3466556309-debug.github.io/yanyu-cishu/
```

## 10. 本轮修改的主要文件

- `public/js/import-core.js`（新增）：文本/表格/讲义/OCR 抽取纯逻辑
- `public/js/import-files.js`（新增）：Excel、Word、PDF、图片的浏览器本地读取和 OCR
- `public/js/importer.js`：保留旧导入 API，转接新解析
- `public/js/app.js`：预览、编辑、删除、二次校验、确认写入
- `public/js/views.js`：导入弹窗的文件类型和新预览入口
- `public/css/app.css`：预览表格和状态提示样式
- `public/sw.js`：新外壳缓存版本，预缓存解析库
- `public/vendor/*`（新增）：免费第三方解析/识字部件及许可证
- `scripts/build-pages.mjs`、`scripts/build-cf-assets.mjs`：新增资源必需清单
- `scripts/smoke-import.mjs`（新增）：真实浏览器导入冒烟
- `tests/import-formats.test.mjs`、`tests/fixtures/import/*`（新增）：格式测试与夹具
- `public/_headers`：CSP 增加 WASM 许可
