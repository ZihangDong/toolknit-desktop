# 默认内核替换记录（2026-11-17）

用户明确要求替换默认内核后，Windows 桌面安装包现携带并优先使用 `toolknit-lo-26.2.5.2-cjk.7-dev`。已完成本机已安装版本升级及普通启动验证，不再需要开发环境变量指向 `D:\tk-lo`。转换不调用 WPS/Word。

## 随包内容与默认发现

- 默认路径：`<安装目录>\resources\office-kernel\runtime\program\soffice.com`。
- 保留运行程序、共享数据、Python/UNO、应用本地 MSVC 库、上游许可证和通知、固定上游版本及全部 16 个补丁。
- 清单覆盖 4667 个文件、541465140 字节，清单本身的 SHA-256 为 `d78116410f50cd20e5c98c666f4da6b6654c6a7330a40b656188b8b820f7d09e`。
- `runtime.lock.json` 固定清单和核心模块哈希；打包前验证所有文件，运行时验证核心文件。完整性验证失败报告错误，不把校验失败当作已安装成功。
- 普通运行优先发现随包内核；显式环境变量保留给开发诊断。CLI/MCP 在源码环境及常见桌面安装位置发现同一内核，并验证相同固定清单。
- 界面将该来源显示为“随应用内置”；旧版下载运行时保留，未覆盖或删除系统 Office 安装。
- 程序内 Word 导出禁写 Python 字节码，打包检查清理 QA 缓存并拒绝其他未声明文件。默认 Python 配置路径改为用户可写目录，转换仍使用独立配置。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 固定运行时全部文件 | 暂存资源、NSIS 解包内容及安装目录三处均通过全部哈希校验 |
| 原生发现 | 不设置 `TOOLKNIT_LIBREOFFICE_PATH`，发现结果为 `source=bundled`、LibreOfficeDev 26.2.5.2 |
| CLI 安装目录发现 | 在不含源码运行时的隔离目录执行，选中 `C:\Program Files\toolknit-desktop\resources\office-kernel\runtime\program\soffice.com` |
| 完整性及优先级测试 | 新增 2 项 Rust 测试通过，修改核心二进制或清单会失败 |
| Word 实际调用链 | 无环境变量覆盖的桌面原生、CLI、MCP 的 DOC/DOCX 导出通过 |
| 三份真实样本 | 原生批处理通过；开题 5 页、任务书 3 页、论文 36 页；源文件哈希未变 |
| 三份样本打包前后 | 全部字符、字体、大小、字形边界及图像数与 v4 对照一致，字形边界最大变化小于 0.001 pt |
| 随包内核排版回归 | 23/23 通过，Writer 模块哈希与原验证版本一致 |
| PPT 实转 | PPT 转 PDF 回归通过 |
| Excel 实转 | XLSX、XLS、ODS、含可见表的 XLS，工作表选择、公式、纸张及方向检查通过 |
| CLI 打包 | 2694 文件、26894729 压缩字节，通过包契约；不重复携带大型内核 |
| 桌面发布审计 | 4724 原生资源检查通过，无公共资源重复及私有维护文件 |
| 桌面完整构建 | Release exe 与 NSIS 安装包生成成功 |

首次真实样本原生测试使用了未配置为输出根目录的 `D:\work`，被既有输出路径限制拒绝；随后在允许的 Downloads 目录重跑通过，并将结果复制到样本目录。没有修改输出路径安全规则。

## 已安装版本与产物

已使用新 NSIS 安装包更新 `C:\Program Files\toolknit-desktop`。安装后的 exe 与从该安装包解出的 exe 字节一致，SHA-256 为 `e353c45eeee3b5d9fd90ed7597522d71076f035c1151d5dbccecdaab14f3020e`。已从该安装目录普通启动，不设置内核环境变量。

安装包：`src-tauri\target\release\bundle\nsis\toolknit-desktop_3.3.0_x64-setup.exe`，218479078 字节（约 208.4 MiB）。此安装包包含修复内核。

安装包 SHA-256：`4d9571d31c4375b3eac5286c35c6ed45223b1e0724cc7df36c5100778330fe39`。

Writer 模块 SHA-256：`2ebad22dcb6996308387eb4705728057c393f4fa7d7d64ea3edb8821dcce2b50`。

本次是默认运行时替换，`visualFidelityApproved=false` 仍保持。标题、参考文献等残余坐标差异见 `validation-cjk7-20261117.md`，不能把默认内核替换完成描述为全稿视觉一致验收通过。

## 复查证据

- 完整打包：项目 `tmp\desktop-cjk7-final-default-build.log`。
- 安装包解出并全量校验：项目 `tmp\bundled-installer-qa-20261117`、`tmp\bundled-installer-extraction.log`。
- 全量发布审计：项目 `tmp\bundled-release-audit-final.log`。
- Rust 发现及缓存：项目 `tmp\bundled-default-discovery.log`。
- 安装后独立发现：项目 `tmp\bundled-installed-discovery.json`。
- 普通安装版启动：项目 `tmp\bundled-installed-launch.json`。
- Word 原生/CLI/MCP：项目 `tmp\word-pdf-bundled-native.log`。
- 三份样本：`<local-samples>\ToolKnit-默认内核复测-20261117` 下的三个 PDF 和 `默认内核验证.json`。
- 三份样本原生批处理：项目 `tmp\bundled-real-samples-final.log`；原始输出位于 Downloads 的 `ToolKnit\默认内核复测-20261117`。
- 排版通用回归：`D:\tk-lo\cjk7-packaged-fixtures\report.json`。
- PPT/Excel：项目 `tmp\bundled-ppt-smoke.log`、`tmp\bundled-excel-smoke.log`。
- CLI 打包：项目 `tmp\bundled-cli-package-contract.log`。
