# 图像转 PDF 维护说明

V3.2 新工具，当前在本地验证中，未发布。入口为 PDF 分类及“V3.2新功能”，工具编号 `image-to-pdf`，懒加载根 `imagePdfOverlay`，初始化器 `initImagePdfTool`。

## 责任与契约

- `features/image-to-pdf/core.js`：输入与页面预算、A4/原图纸幅、自然排序、旋转、质量规划和安全名称。
- `input.js`：浏览器读取及原生解码 adapter；`worker.js`：白底、摆放、扫描像素、编码、逐页 PDF 写出；`export.js`：结果导出和临时写入清理。
- `controller.js`：当前会话、导入事务、页列表、按需缩略图、预览 revision、取消、错误和结果交互。
- `core/image-dimensions.js` 从既有 PPT 图像核心提取无依赖的栅格尺寸读取，PPT 保留原接口；图像 PDF 不加载 JSZip。
- `core/pdf-scan.js`、`shared/scanned-pdf-writer.js` 被 PDF 转扫描件及图像 PDF 复用；旧 feature 核心/writer 仍转发，兼容已有调用。
- 新增原生命令 `inspect_image_pdf_input`、`read_image_pdf_page`、`open_image_pdf_result`，仅允许主窗口。检查返回 SHA-256、帧尺寸/分辨率与容量；读取核对摘要并返回二进制 PNG。全局信号量限制原生同时解码，阻塞任务持有许可直至结束。
- 保存复用 `begin/append/finalize/discard_pdf_enhance_write`，目录 `Image_PDF`，校验页数后原子发布唯一名称。新增工具不改变既有存储键、事件、CLI/MCP 或版本。

## 行为与限制

最多 100 页，单文件 64 MiB，输入合计 256 MiB，输出 100 MiB。原图最长边 32768、最多 4000 万像素；渲染最长边 8192、最多 1600 万像素。逐页转码，PNG 嵌入后及时释放解码通道，不累计全部完整 RGBA。

A4 按原像素比例等比居中，支持方向与 0/8/15 mm 页边距；原图模式读取 PNG、JPEG、WebP、BMP、TIFF 的有效物理分辨率，缺失时按 96 DPI。解析同时约束头部条目与数据范围，照片方向旋转后分辨率轴同步交换。原图尺寸超过 PDF 范围会提示使用 A4。小图不伪造细节，A4 画布仍保留足够像素表示实际边距。透明底为白色；GIF/WebP 首帧，TIFF 每帧一页。

常规 TIFF RGB/RGBA、灰度、16 位、CMYK、BigTIFF、多页及传真编码由受限解码器处理；特殊颜色编码（如 CMYK 加透明通道）会在导入时拒绝并给出转换建议。浏览器没有 TIFF 解码器，使用桌面端。扫描效果是图像外观处理，不执行 OCR、透视纠正或自动裁边。

浏览器与原生解码路径分别验证。桥接测试使用真实 Rust 解码结果与正式构建的 Worker，Tauri IPC 由隔离夹具实现；随后单独通过真实 Rust 写入、qpdf 与 Windows 原子发布验证。不得把这种分层测试写成已在完整安装版 WebView2 中验收。

## 验证入口

- `npm run test:image-to-pdf`：几何、顺序、预算、双语与入口契约、实际 PNG/JPEG PDF。
- `npm run test:image-to-pdf-browser`：正式构建双主题、双语、图像导入、排序、旋转、透明度、灰度/扫描、重置、重开和真实 PDF 重读渲染。
- `cargo test --manifest-path src-tauri/Cargo.toml image_pdf_tests --lib`：原生 TIFF、方向、透明度、摘要、范围与路径。
- `scripts/prepare-image-pdf-matrix.mjs` 创建合成矩阵；设置 `TOOLKNIT_IMAGE_PDF_MATRIX_ROOT` 指向该目录，显式运行 ignored 的 `image_pdf_format_matrix`。
- `scripts/test-image-pdf-native-bridge.mjs` 消费原生解码矩阵并验证分块 IPC、保存失败/取消、结果按钮；随后显式运行 ignored 的 `image_pdf_native_publication_matrix` 检查真实保存。
- `scripts/test-image-pdf-resolution-browser.mjs` 使用同一矩阵比较实际浏览器 PDF 与原生物理尺寸，包括照片旋转、横纵 DPI 不同、PNG/JPEG/WebP/BMP；`test-image-pdf-print-quality.mjs` 使用 300 DPI 中文小字样本和 Poppler 检查高清嵌入像素与三档输出。

所有图像、PDF、截图、报告 JSON 和日志保留在忽略目录 `tmp/v32-pdf-creation/`，不收录用户私人文件。最终门禁结果与未覆盖环境见本轮方案记录。
