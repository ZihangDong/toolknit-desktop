# V3.3 共用本地 OCR 实施与验证

2026-11-06，V3.3（开发中），3.3.0 未发布。实现与本轮验证已完成。实现验收当轮未提交、推送或制作安装包；随后按用户授权生成的测试包见末节。

## 已实现

- `src-tauri/src/native_runtime/ocr/`：PP-OCRv5 mobile det/rec、DB 几何、透视裁切、CTC、长图重叠分块、细笔画增强及栅格表格线。CPU 推理复用现有 ORT DLL，不向用户分发 Python/Paddle/OpenCV。
- `src-tauri/src/platform/onnx_runtime.rs`：OCR 与抠图共用 DLL 定位及进程级句柄，保留抠图原有错误契约。
- `src/platform/local-ocr-runtime.js` / `src/app/local-ocr-runtime.js`：统一模型管理、首次使用安装、进度、取消、重装和移除，复用现有弹框及深浅主题。
- 截图提字接共用识别器，并可接现有本地中英翻译。无需 AI Key；只有用户主动的 AI 路径才可外发。CTC 原始文本直接使用，避免按字符框插入拉丁空格。
- PDF 处理器在扫描/大幅栅格区域注入识别。原生文字优先去重，Worker 重建可编辑文字、段落、多栏和有线表格。保留原页与连续 A4 两种模式均沿用现有 DOCX 写入。
- 先清除被替换的底图文字，再写真正的 Word 文本；扩展检测框覆盖边缘残墨，并保护邻近表格线。局部底色及彩色标题单独处理，红色印章、复杂照片背景、低置信度和不支持的竖排保持可见图像。
- OCR 表格沿用写入器的实际单元格测量。极小或过紧的表格无法容纳文字时保留原图，避免整篇失败；其来源账本标记为图像，绝不算作可编辑文字。

## 模型与分发

原始来源与许可见 [托管准备快照](V33_OCR_MODELS_DISTRIBUTION_20261106.zh-CN.md)。衍生 ONNX 固定在 `models/ocr/pp-ocrv5-mobile/onnx-20261106-r1/`，仅使用已有七彩云公共下载桶。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| det.onnx | 4766440 | c8d9b07063420ce5365c74e42532de48238feeeedcdb7a330b195708bc38a93f |
| rec.onnx | 16529870 | bcb195e3463eb9e46ef419b8a01ea4729577de5fd63c64f0a762e43bd64256e7 |
| dictionary.json | 110788 | d858428fbe0ada92b439a5f277b51bc1b318fd985d80946a3ce859d7f2446a92 |

合计 21407098 字节，约 20.4 MiB。模型、衍生清单、Apache-2.0 和来源声明均已上传；三份运行文件匿名下载校验通过。安装只接受编译期固定文件，校验大小、哈希和模型加载；失败或取消保留已有安装。

工程转换使用 Paddle 3.1.1、Paddle2ONNX 2.1.0、ONNX opset 17，未训练或量化权重。导出准备脚本为 `scripts/prepare-ocr-runtime.py`。模型输出 18385 类，字典保留原顺序并映射 CTC blank/space。帮助中心、NOTICE 和安装目录保留许可及衍生记录；新引入的 22 项原生依赖许可文本随桌面资源分发；第三方模型原有权利不受 ToolKnit 自有代码许可替代。

## 契约与资源

- 新命令 `local_ocr`；主窗口管理安装，截图窗口识别须校验活动会话，其他窗口拒绝。拒绝未知字段及任意下载地址。
- 原生每次仅一项识别工作，阻塞计算移入工作线程；模型延迟加载，空闲 120 秒后释放。取消支持先到请求和会话结束；过期前端操作不写回新页面。
- 图片上限 24 MiB / 3200 万像素；检测候选、CTC 通道、字符数、裁切分配及每页时间均有限制。PDF 保留既有 64 MiB / 300 页、每次最多 100 页、1600 万渲染像素等边界。
- 工具数量未增加：75 桌面工具、12 分类、78 CLI/MCP；新增后共 160 个命令实现 / 159 个名称。扫描 OCR 本轮为桌面能力，CLI/MCP 继续明确说明其不含本地扫描 OCR。
- 原文件只读，结果沿用唯一命名及原子发布。私人文件、正文、路径和截图不进入公开夹具、文档或外部模型。实测副本、进程日志和图片证据保存在本机仓库外的审计目录或忽略的 tmp。

## 实测结果及口径

| 验证 | 结果 |
| --- | --- |
| 固定入门真值集 | 5 张：亮/暗截图、小字、轻微倾斜、有线表格；556 个非空白参考字符，首轮逐字符一致 |
| 额外冻结真值集 | 合同、浅色、JPEG 压缩、双栏、长截图共 5 张，3215 个非空白参考字符；修复后 73 个原始字符差异，其中 72 个为连续签名下划线作为图形保留，1 个为全/半角括号差异 |
| 字符指标限制 | 上项原始字符正确率约 97.73%；不能删除这些差异后声称通用 99%。单独进行 NFKC 和签名线处理的正文比较只衡量正文，与保留图形及可编辑性分开报告 |
| 独立实验 | 另有 1 张增强派生样本，不计作新增独立真值样本 |
| 本机文件 | 9 页现有图像 PDF 与 3 页合同/活动方案的只读栅格测试副本；12/12 原生识别完成。没有人工逐字符真值，不为其填写正确率 |
| Word 场景矩阵 | 23 张图像、两种排版共 46 份 Word 完成导出与 XML 来源检查；该矩阵为直接场景/写入器验证，不冒充全套桌面点击验收 |
| Word 显示 | 14 份 Word 经本地 LibreOffice 转 PDF，完成渲染；修复后另复验双栏和实际合同。纯文字双栏清理底图残留暗像素为 0，避免旧字重影 |
| 浏览器完整处理链 | 真实 PDF.js 渲染、OCR 提供器注入、实际 Worker、Word 表格输出；原页/连续两种模式及取消通过。提供器使用预先经本机模型验证的合成样本结果，不冒充 Tauri IPC 全流程 |
| 安装真实闭环 | 七彩云下载、哈希、引擎加载/识别、取消保留旧版本、损坏拒绝通过；隔离目录不修改用户正式模型 |
| 截图识别 → 本地翻译 | 真实 OCR 输出接已安装 MTranServer，本机环回请求完成中译英；无需 Key、无外部图片上传 |
| 重复稳定性 | 同一引擎连续 100 次固定小图识别，100/100 成功且文本一致。平均 320.9 ms；独立原生测试进程观察峰值 132.3 MiB、热身 58.4 / 结束 64.0 MiB。这不是整个应用内存，也不能代表未知机器和文件的普遍成功率 |
| 界面 | 深浅主题、低高度弹框、进度、取消、首用安装续接、已安装状态、Escape 通过；实际桌面首次截图安装返回与不同阅读器仍需用户验收 |

既有 FFmpeg/LibreOffice 等模型和个人设置保持兼容。本轮“99%”作为持续优化目标；文字正确、版面接近、可编辑和运行不崩溃分别衡量，有限样本不等于所有 PDF 均有 99% 正确率。手写、严重模糊、竖排、复杂公式和密集装饰仍有明确限制。

## 回归门禁

- `test:release` 完整 115 项脚本通过，包含 CLI 独立安装、MCP、真实本机转写及发布产物检查；未执行 npm publish。
- 最终 `test:architecture`、`test:security-release`（1833 项）、`build` 通过。最后的 OCR 边界修正另跑 focused tests 和浏览器 PDF/Worker 处理链；构建已刷新。
- 完整 `cargo test`：324 passed、0 failed、29 ignored；其中 3 项 OCR 显式模型/安装/翻译测试均已单独实际执行通过。主程序及 doc-tests 通过。
- `test:help`、桌面状态/整合审计、Skill 校验和差异检查通过。仅保留既知 chunk / crypto externalization / Windows linker 提示；已移除不再用于生产的 Windows OCR 模块所产生的新 unused 警告。
- 已通过：OCR 几何/CTC/边界、像素清除/印章/彩色文字/表格线、模型真实安装、本地翻译、OCR 管理界面、PDF 原有 focused tests、模型匿名下载和 Word 场景/渲染矩阵。
- Skill：入口仅增加 OCR 专项路由；关键责任、残墨/分块/字符间距经验放按需 reference，未追加整轮日志。Skill 校验通过。

## 2026-11-06 测试包

用户随后授权打包，使用 `npm run build:test-package -- --bundles nsis` 完成 Windows x64 NSIS 构建，包含本轮 OCR 全部改动，版本保持 3.3.0，启用 QA/F12。

- 文件：`src-tauri/target/release/bundle/nsis/toolknit-desktop_3.3.0_x64-F12-test-OCR-20261106-134712-setup.exe`。
- 大小：57730688 字节，约 55.06 MiB。
- SHA-256：`2b4f9878821b6b61bbe67beeb252915f601f03116676fcd9b1da897e966bc318`，时间戳副本与默认构建原件一致，旁置 `.sha256` / `.json`。
- 版本/QA 配置、实际 EXE 原生加载依赖、产物审计通过；确认新 EXE 包含 PP-OCRv5 与 local_ocr，并核对 NSIS 资源含 ORT DLL 和新增依赖许可。
- OCR 模型仍经七彩云按需下载约 20.4 MiB，不捆绑进主安装包。未在用户正式安装目录执行覆盖安装，实际安装与交互由用户验收；没有提交、推送或外部发布。
- 本次仅打包，沿用已验证的功能代码、Skill 与 V3.3 更新日志，不重复追加功能条目。构建日志：`tmp/ocr-test-package-build.log`。

## 2026-11-06 截图按钮故障修复

测试包反馈：快捷键截图后，本地提字和翻译均出现通用操作失败，AI 提取正常。根因在 `capture-editor.js`：共用 `recognize()` 引用了外层不存在的 `signal`；同名变量只声明在后面的翻译分支内。抛出的 ReferenceError 被统一反馈捕获，因此没有未捕获的 F12 异常。

- 在每次操作开始时捕获固定 AbortSignal，提字、翻译与 AI 取消共用当前操作信号；旧任务无法借用下一次操作的控制器。
- 模型状态返回后重新校验取消，避免用户取消后才跳转安装引导。真实 CTC 提字直接使用解码行，保持英文单词和标点间距。
- 原生实测发现既有翻译配置为 LF、编译时清单为 CRLF，原字符串比较使有效安装被判为缺失。OCR 就绪标记及翻译清单只归一换行；原有清单内容、文件大小和哈希门禁保持。
- 旧截图浏览器夹具同步改为 `local_ocr` 真实命令契约。新增 `npm run test:screenshot-ocr-browser`，执行实际 auxiliary 页面、按钮事件闭包和 platform adapter，覆盖双主题、无 Key 本地翻译、缓存、失败恢复、取消/迟到结果、慢状态检查取消与缺模型交接。此测试在修复前可复现提字失败，修复后通过。
- `native_ocr_tests.rs` 提供显式隔离的 WebView2 测试；合成图片替代桌面采集，使用真实 Tauri 命令、活动截图会话及本地模型。隔离开关仅编译进 Rust 测试，不进入客户端配置；模型及用户设置不因测试改动。
- 完整截图浏览器回归通过四组主题/尺寸/DPR，含原提字/AI/翻译流程及截图历史、查看器、自绘菜单。OCR 管理弹框双主题回归通过。AI 请求仅在测试 IPC 中模拟；真实原生实测没有配置密钥或外发图片。

最终验证：

- `screenshot_local_ocr_webview` 通过：真实截图按钮、会话绑定 IPC、中文及英文词间距、无 Key 本地翻译/覆盖布局、过期会话拒绝、关闭后图片和 Canvas 释放。使用 `TOOLKNIT_OCR_WEBVIEW_APPDATA` 指定隔离模型根目录（包含 `ToolKnit/local-ocr` 和 `ToolKnit/local-translation`），`TOOLKNIT_OCR_WEBVIEW_IMAGE` 指定合成 PNG；不写入用户正式模型目录。
- `screenshot_webview_startup` 通过 100 次 1080p/4K 会话、重复通知、失效票据、单窗口复用及销毁后冷重建。最初调试构建反复编码相同 4K 合成图超出测试总时限；夹具改为每个尺寸缓存一次，复验约 16.5 秒。仅用于测试生命周期，不作为真实桌面截图速度承诺。显式销毁旧 WebView 壳时出现一次 WRY 无效句柄诊断，随后冷重建及资源校验通过。
- `test:release`：115 项 npm 脚本通过，包含构建、架构、1835 项安全检查及 CLI/MCP；完整 Rust 为 325 passed、0 failed、30 ignored，主程序和 doc-tests 通过。上述两项需真实 WebView/模型的 ignored 测试已另行显式执行通过。
- 双主题实际按钮回归、OCR 管理界面、桌面整合审计、Skill 校验和差异检查通过。没有新增 DOM/storage/event/Tauri/CLI/MCP 契约；版本保持 3.3.0。
- 本轮功能源码未重新打安装包。用户先前的时间戳测试包保留作为问题来源；下一次授权打包时需包含本节修复。

本轮日志：`tmp/screenshot-ocr-native.log`、`tmp/screenshot-ocr-startup-native.log`、`tmp/screenshot-browser-full.log`、`tmp/screenshot-ocr-release.log`、`tmp/screenshot-ocr-rust.log`。Skill 仅补充真实按钮闭包、固定取消信号、ready 握手及清单换行兼容的验收要求。

## 修复后测试包（2026-11-06 14:53）

用户随后授权重新打包，`npm run build:test-package -- --bundles nsis` 成功，包含上述提字、翻译、取消及模型换行兼容修复。版本保持 3.3.0，Windows x64，启用 F12；旧时间戳包保留。

- 安装包：`src-tauri/target/release/bundle/nsis/toolknit-desktop_3.3.0_x64-F12-test-OCR-fix-20261106-145356-setup.exe`。
- 大小：57672613 字节，约 55.00 MiB；SHA-256：`ec97a537acfaea4d6e39bf78340692142c7f2785aada22c26750dbe3d666c2af`。旁置 `.sha256` 和构建元数据 `.json`，副本与构建原件哈希一致。
- 实际 EXE 版本、QA/OCR 编译标记、30 项原生加载依赖及 55 份资源审计通过。沿用紧前修复轮的 115 项发布脚本、325 项 Rust 与真实 WebView 提字/翻译、100 会话验证；没有为了打包重复完整测试。
- 模型不捆绑进主包，仍经七彩云按需下载约 20.4 MiB。本轮只构建并检查安装包，没有覆盖用户正式安装或外部发布。
- 构建日志：`tmp/screenshot-ocr-test-package-build.log`；产物记录：`tmp/screenshot-ocr-test-package-result.json`。功能日志与 Skill 沿用紧前修复轮，不重复追加功能条目。

## 截图翻译改为纯本地（2026-11-06）

用户确认 14:53 OCR 修复测试包正常，并要求截图翻译直接使用 OCR 结果。本轮固定为 PP-OCRv5 → 本地中英翻译 → 原位覆盖排版；独立的 AI 提取内容保留。已有模型安装后可以离线翻译，AI 配置、密钥或服务错误不参与此流程。

- `capture-editor.js` 移除 AI 校正、密钥读取、校正缓存及确认回退。只有 AI 提取保留 provider 快照；修改 AI 设置不再取消 OCR、本地翻译或其他本地操作。保留取消、过期结果隔离、OCR 缓存、目标语言、译文覆盖、编辑及撤销。
- `translation.js` 移除不再使用的 AI 批次/预算/重试；`core.js` 移除仅供该分支使用的 JSON 解析器。调用检索确认没有其他消费者。中英文进度及帮助去除旧 AI 校正说明，截图隐私提示明确仅独立 AI 提取外发图片。
- 保留已有 `ai-translate` action 和 `aiTranslate` 文案 key，避免更改入口契约；它们的名称不代表仍发起 AI 请求。未改变 DOM、storage、事件、Tauri、CLI/MCP 或模型下载契约。
- 实际按钮回归使用已配置的模拟密钥，并拒绝所有 AI/密钥读取：仍完成本地翻译。覆盖无密钥、无效配置、AI 服务故障，以及翻译过程中修改 AI 配置，确认零 AI 请求和零密钥读取；独立 AI 提取及其取消/配置变更路径继续通过。
- 双主题、四组尺寸/DPR 的完整截图界面回归及真实 WebView2 OCR/本地翻译通过；真实原生测试不外发图片、不使用私人文件。模型缺失、取消、关闭、迟到结果、超时、译文溢出和语言选择均通过。
- `test:release` 的 115 项脚本通过，含 1835 项安全检查、架构、构建及独立 CLI/MCP 包验证。完整 Rust 为 325 passed、0 failed、30 ignored，主程序与 doc-tests 通过；上述 WebView ignored 测试另行显式通过。Skill 的 OCR 规则及记录/窗口引用同步改为本地翻译固定流程，移除旧的 AI 校正规则；整合审计、Skill 校验和差异检查通过。

证据：`tmp/local-screenshot-translation-focused-browser.log`、`tmp/local-screenshot-translation-browser.log`、`tmp/local-screenshot-translation-native.log`、`tmp/local-screenshot-translation-release.log`、`tmp/local-screenshot-translation-rust.log`。本轮只更新源码；14:53 测试包保留原内容，纯本地翻译调整需后续重新打包。

## 纯本地截图翻译测试包（2026-11-06 15:38）

用户授权后以 `npm run build:test-package -- --bundles nsis` 重新构建 Windows x64 / F12 测试包，版本保持 3.3.0，包含上述纯本地截图翻译调整。

- 文件：`src-tauri/target/release/bundle/nsis/toolknit-desktop_3.3.0_x64-F12-test-local-translation-20261106-153802-setup.exe`。
- 大小：57699923 字节，约 55.03 MiB；SHA-256：`8ad4cb458162bd79c04745af7ecfcb1c7b2d14d4307a273ea9f52de2d726f088`。时间戳副本与构建原件一致，旁置 `.sha256` / `.json`。
- 已核对新 EXE 的 3.3.0 版本、QA/OCR 标记及 30 项原生加载依赖；产物审计 55 份资源通过。构建后的前端不含旧截图 AI 校正提示词及外发说明，模型仍按需下载，不随主包捆绑。
- 沿用紧前源码轮通过的 115 项发布脚本、325 项 Rust 及真实原生/双主题按钮验证。旧时间戳包保留；没有执行安装或外部发布。本轮仅打包，Skill 和功能日志沿用已验证的纯本地流程规则。
- 构建日志：`tmp/local-translation-test-package-build.log`；产物元数据：`tmp/local-translation-test-package-result.json`。
