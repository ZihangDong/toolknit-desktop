# PDF 转扫描件：V3.1 开发说明

入口：普通 PDF 分类的“PDF 转扫描件”。工具 ID 为 `pdf-to-scan`，根 overlay 为 `pdfScanOverlay`，懒加载入口为 `initPdfScanTool`。不需要 AI、API Key 或网络上传。

## 用户流程

1. 选择或拖入一个 PDF。密码文件通过临时密码弹框解锁，密码不写入设置或日志。
2. 逐页预览，可全部选择、取消选择或输入 `1-3, 5` 之类的范围。重复页码去重，始终按原稿顺序导出。
3. 选择原稿图像、灰度扫描或自然扫描。默认原稿模式、200 DPI；可选 150/200/300 DPI。
4. 自然模式可微调颗粒、纸张暖色和倾斜。倾斜采用等比缩小以容纳全部内容，避免切掉边角。原稿和效果预览可切换，缩略图栏可展开收起；Escape 优先恢复侧栏。
5. 显示真实逐页进度，完成后显示结果弹框。桌面端保存到配置输出目录的 `PDF_Scan` 子目录，打开文件夹传入最终结果文件以便选中；浏览器回退为下载。

## 内容和安全边界

- 原文件不修改。每个选中页面渲染成 JPEG 后组成新的图像 PDF，保留原页面的可见宽高和方向，包括混合尺寸和旋转页。
- 输出不含原文字层、交互链接、表单或原数字签名。签名的视觉图案可能出现在图像中，但不具备原签名的验证能力。图像仍可被 OCR 识别；此工具不是防复制、信息脱敏或文件真实性证明。
- 原稿模式不添加扫描特效，但经过像素化和 JPEG 压缩，不是无损转换。自然效果只用于外观，不伪造原稿内容。
- 单文件上限 64 MB、100 页；单页最多 1600 万像素、单边 8192 像素；输出最多 100 MB。超限提示降低 DPI、减少页面或先拆分，不静默降清晰度。
- 解析超时 60 秒，转换超时 10 分钟。关闭、取消、换工具会失效旧结果并释放本实例的 PDF、Canvas 和 Worker。
- Native 输出复用已有 `begin_pdf_enhance_write`、`append_pdf_enhance_chunk`、`finalize_pdf_enhance_write`、`discard_pdf_enhance_write`。临时写入、qpdf 校验和唯一名称原子发布遵循既有后端安全边界。
- 写入最后的原子发布阶段后禁用取消；此时关闭页面可能仍完成有效文件的保存，但迟到结果不会弹出到新会话。

## 实现职责

| 模块 | 职责 |
| --- | --- |
| `features/pdf-to-scan/controller.js` | 状态、文件/密码、参数、预览、进度/结果弹框、生命周期 |
| `core.js` | 限制、页码、DPI、尺寸、像素效果、倾斜和安全文件名 |
| `processor.js` | 逐页 PDF.js 渲染、JPEG 编码、输出发布与清理 |
| `scan-worker.js`、`worker-client.js`、`writer.js` | Worker 像素处理和逐页 pdf-lib 组装、请求超时、结果结构校验 |
| `template.js`、`pdf-to-scan.css` | 可信静态模板、既有工作台及双主题参数布局 |
| `shared/pdf-workbench.js` | 可选 `transformPreview` 钩子；默认行为兼容原有工具 |

不新增 Tauri command、storage、事件或 CLI/MCP 能力。新 DOM ID、首页入口和双语 key 由工具契约测试维护。

## 验证入口

```powershell
npm run test:pdf-to-scan
npm run test:pdf-to-scan-tool-contract
npm run test:pdf-to-scan-browser
```

浏览器回归使用合成多页表格和彩色块、横页/旋转页、qpdf 加密文件；实际下载输出校验页数、尺寸、顺序、JPEG 可解码、效果像素和文字层为空。还检查双主题、语言、低高度/窄窗口、弹框焦点、取消、重置及关闭重开。截图和样本只保存于忽略目录 `tmp/pdf-to-scan/`。

帮助中心回归从首页设置进入，验证中英文 PDF 转扫描件入口、处理步骤、文件限制和 OCR/签名边界；共享回归抽查已有 PDF、PPT、Markdown 与硬件页面。

浏览器测试不能代替 Windows 安装包、原生文件选择器、真实输出目录权限和资源管理器的桌面实测；具体执行结果以根目录 `changelog.md` 当前记录为准。
