# PDF-IMPORT-FIX 验收说明

日期：2026-11-11
范围：`yanyu-cishu` 的 PDF 导入与失败提示；不改公考错题本，不拆 Cloudflare 登录版。
入口：https://3466556309-debug.github.io/yanyu-cishu/

## 一、原因

1. **iPad Safari 上的 PDF.js Worker 不可靠。** 当前 PDF.js 4.x 用 `new Worker(..., { type: 'module' })` 启动 `pdf.worker.min.mjs`。iOS Safari / 旧 WebKit 上 module worker 可能构造失败、加载失败或一直不 ready。旧代码 `parsePdf` 把 `getDocument` 的任何失败都写成：
   > 这个 PDF 打不开，可能已经损坏或不是真正的 PDF。
   这份讲义本身是 PDF 1.3、28 页、未加密，问题出在解析部件/Worker，不是文件。
2. **旧抽词只按版面文字猜列。** `pdftotext -layout` 或 `layoutPdfText` 会把“大类/小类/成语/解释”四列挤成正文，旧逻辑于是把“大类”“5个”“中华文明传统”“更多免费考公资料”等小标题/页脚当成词条，真实讲义的表格没有按列还原。

## 二、改了什么

### 1. Worker 失败后回退主线程（`public/js/import-files.js`）

- 新增 `openPdfDocument`：先正常用 Worker 打开；Worker 构造/加载失败或 20 秒没启动时，销毁旧任务，动态加载 `pdf.worker.min.mjs`，设置 `globalThis.pdfjsWorker`，再用 pdf.js 的 fake worker 在主线程重试一次。
- 重试前复制一份 `Uint8Array`，避免第一次尝试把底层 buffer 转移给 Worker 后无法复用。
- 文件本身无效、加密或明确不可读时不盲目重试，直接按对应原因提示。
- 页面文字解析（`getPage` / `getTextContent`）单独捕获：提示“这份 PDF 能打开，但第 N 页的文字没有解析出来”，不再说文件损坏。

### 2. 失败提示按事实分开（`public/js/import-files.js`）

现在至少区分：

| 情况 | 提示要点 | 下一步 |
| --- | --- | --- |
| 文件无效/没下载完整 | 文件本身无效或没有下载完整 | 重新下载/另存普通 PDF；能打开就截图按图片导入 |
| 加了密码 | PDF 没有损坏，但加了密码 | 先在阅读器去掉密码 |
| Worker/解析部件没起来 | 解析部件在这个浏览器里没有启动成功（文件本身不一定是坏的） | 刷新、换 Safari/Chrome/Edge、另存普通 PDF 或截图导入 |
| PDF 能打开但某页文字失败 | 能打开，但第 N 页文字没解析出来 | 刷新；截图导入或另存普通 PDF |
| 只是版面没认出“词语+释义” | 明确说“是版面格式没识别好，不是文件坏了” | 粘贴内容或截图导入 |

旧的“可能已经损坏或不是真正的 PDF”已从代码中移除；真正无效的文件才会提示“文件本身无效”。

### 3. 按坐标抽多列表格（`public/js/import-core.js`）

新增 `extractPdfTableSource(pages)`，不再靠字符数猜表：

1. 按 y 坐标还原视觉行、按 x 间距还原单元格；
2. 用列起笔位置聚类找“词语列 + 紧挨着的右侧解释列”，同时比较列文本的词长/句读得分，避免把“大类/小类”列选成词语列；
3. 从每个词条位置向上找到该条释义的起始行，再按相邻词条边界把折行释义拼回去（兼容释义首行比成语高半行、或注解续写到右侧的情况）；
4. 分类小标题、数量标记、页脚、页眉不进入词条；“分类小标题没有释义”的进入跳过列表并说明原因；
5. 表格外的正文词条（如“雷厉风行：……”）继续走正文抽取，CSV/TXT/Excel/Word/图片/粘贴逻辑不变。

新增自造夹具 `tests/fixtures/import/table-lecture.pdf`（约 79KB，四列表格、折行释义、分类小标题、页脚；不含用户原件）。

### 4. 缓存版本

`public/sw.js` 的 `CACHE_NAME` 升到 `yanyu-cishu-v4-20261111-pdf`，避免 iPad 上旧 Service Worker 继续发旧 JS。文轩如果还看到旧页面，刷新一次或清一下站点缓存即可。

## 三、验证

### 自动测试

```text
npm test
# tests 44
# pass 44
# fail 0
```

新增测试覆盖：

- 四列表格 PDF 按坐标抽词，释义折行拼回，分类小标题/页脚不进入词条；
- 小表格 PDF 同时保留表格列和表格外正文词条；
- PDF 失败提示区分文件无效/密码/解析部件，并检查 Worker 回退代码仍在。

### 本机浏览器

```text
npm run pages:build
node scripts/smoke-pages.mjs --dir pages-dist /yanyu-cishu/
node scripts/smoke-import.mjs --dir pages-dist /yanyu-cishu/
```

结果：Pages 本机模式、初始 60 词、练习打卡、PWA 新缓存、Excel/Word/PDF/图片/扫描件/粘贴全部通过；无控制台异常。

用用户原件做本机冒烟（文件只在 `.tmp-user-pdf/`，未提交）：

- 正常 Chrome：打开成功，预览 **842 条**，首条“源远流长 | 源头远，水流长。也比喻历史悠久。”；预览含“博大精深”“一脉相承”“媲美”等，未出现“大类/5个/第一组/更多免费考公资料”作为词条。
- 模拟 Safari module Worker 不可用（页面里让 `window.Worker` 构造直接抛错）：仍打开成功，同样 842 条。
- 伪造坏 PDF：提示“这个 PDF 文件本身无效或没有下载完整”，不再误报成 Worker 问题。

### 公网

- 资源抽查（均 200）：首页、`js/import-files.js`、`js/import-core.js`、`vendor/pdfjs/pdf.min.mjs`、`vendor/pdfjs/pdf.worker.min.mjs`、`vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap`、`sw.js`。
- 公网 `scripts/smoke-pages.mjs https://3466556309-debug.github.io/yanyu-cishu/`：通过，PWA 缓存为 `yanyu-cishu-v4-20261111-pdf`。
- 公网 `scripts/smoke-import.mjs https://3466556309-debug.github.io/yanyu-cishu/`：通过，PDF 夹具 4 条、Excel/Word/图片/扫描件/粘贴正常，控制台无错误。
- 公网 + 用户原件：打开成功，842 条；禁用 `window.Worker` 后仍 842 条；坏 PDF 提示同上。

## 四、已知限制

- 本机没有 iPad/Safari 或 WebKit 运行环境，**没有做真机 Safari 点击验证**。Safari 这一侧由“Worker 失败自动回退主线程”的代码保证，并用 Chrome 禁用 Worker 的路径做了等价冒烟；这是本轮验证范围的边界。
- 主线程回退会比 Worker 慢，28 页讲义首次打开/抽词可能需要多等一会儿；页面不会再把这种情况说成文件损坏。
- 表格抽取针对“大类/小类/词语/解释”这类多列讲义；识别不到表格时仍走旧版面文字逻辑。扫描件仍按原来的本地 OCR 处理，OCR 错字不在本次修复范围。
- 预览中仍可能有少量讲义自身的重复词（按原有冲突规则跳过）或分类小标题进入跳过列表；确认前可改、可删。
- 用户原件没有提交到仓库、Pages 或公网；`pages-dist` 中没有任何 `.pdf` 讲义文件。

## 五、0 元与 Cloudflare

- 全部解析在浏览器本地完成，没有购买服务、没有绑卡、没有调用付费识别接口。
- 没有改公考错题本。
- Cloudflare 登录版未改动、未拆除。本轮没有额外做 Cloudflare 授权/部署，只更新 GitHub Pages；避免为了这次 PDF 修复去动登录版或引入额外登录步骤。

## 六、发布

- 源码：`master`，提交 `cf41a2b`（“修复 PDF 导入：Worker 回退、按坐标抽多列表格、区分失败原因”）。
- GitHub Pages 产物：`gh-pages`，提交 `d9fc66f`（“发布：修复真实讲义 PDF 导入与失败提示”）。
- 已更新地址：**https://3466556309-debug.github.io/yanyu-cishu/**
