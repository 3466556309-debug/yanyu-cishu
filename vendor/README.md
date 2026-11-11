# 浏览器本地导入部件

这些文件随站点一起发布，不通过第三方 CDN 加载，也不需要账号、密钥或付费接口。

| 目录 | 用途 | 版本 | 许可证 | 上游 |
| --- | --- | --- | --- | --- |
| `xlsx/` | Excel `.xlsx` / `.xls` 读取 | SheetJS 0.18.5 | Apache-2.0 | https://www.npmjs.com/package/xlsx |
| `fflate/` | Word `.docx` 解压 | fflate 0.8.3 | MIT | https://www.npmjs.com/package/fflate |
| `pdfjs/` | PDF 文字抽取、扫描页渲染 | PDF.js 4.10.38 | Apache-2.0 | https://www.npmjs.com/package/pdfjs-dist |
| `tesseract/` | 浏览器本地中文识字 | Tesseract.js 6.0.1 / tesseract.js-core 6.0.0 | Apache-2.0 | https://www.npmjs.com/package/tesseract.js |
| `tesseract/lang/chi_sim.traineddata.gz` | 简体中文识别数据 | tessdata_best 4.0.0（`best_int` 压缩包） | Apache-2.0 | https://github.com/tesseract-ocr/tessdata_best |

- `pdfjs/cmaps/`、`pdfjs/standard_fonts/` 来自 PDF.js 发行包，用于中文 PDF 的字体映射。
- 识字核心（`tesseract-core-simd-lstm.wasm*`）和中文数据（`chi_sim.traineddata.gz`）体积较大，第一次选图片/扫描件时才加载；之后由 Service Worker 和 Tesseract.js 的 IndexedDB 缓存在本机。
- 以上许可证文本分别保存在各目录的 `LICENSE*` 文件中。
