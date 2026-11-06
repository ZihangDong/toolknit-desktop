# FFmpeg 对应源码与可追溯构建

2026-11-06。范围为 V3.3 按需 FFmpeg 下载及独立源码仓库。

## 实现结果

旧 Gyan 6.1.1 静态构建的完整依赖修订、补丁和构建控制材料无法从现有公开材料证明。
本轮改为从完整归档输入自行编译 FFmpeg 6.1.6-toolknit-r3，并保留旧快照与缺口说明。
新源码包不冒充旧 EXE 的对应材料。已安装的用户运行时不被静默删除或替换。

- 独立仓库：[toolknit-ffmpeg-sources](https://github.com/ZihangDong/toolknit-ffmpeg-sources)。
- 固定标签：[ffmpeg-6.1.6-toolknit-3](https://github.com/ZihangDong/toolknit-ffmpeg-sources/releases/tag/ffmpeg-6.1.6-toolknit-3)。
- 源码归档提交：cefa64fcf10b1c20d84854c861bfbaaf7ecaa6f8。
- [源码包](https://github.com/ZihangDong/toolknit-ffmpeg-sources/releases/download/ffmpeg-6.1.6-toolknit-3/toolknit-ffmpeg-6.1.6-r3-sources.tar.gz)：50,665,368 字节；SHA-256 为 92bc133e12f3157ca143dd7445210dc340e6ef1c58811a7fe66a273055e479e9。匿名完整下载一致，解压后独立校验通过。

## 材料与构建

| 位置（独立源码仓库内） | 内容 |
| --- | --- |
| source/ffmpeg-6.1.6/ | 官方 n6.1.6，提交 f1e3a2bf7a2f2cde936d1ed97f09a26853d20125；8195 文件及 Git 树 9aaca04fcc4bb2a56d3a06bab6d262d587956dc2 与官方一致 |
| third-party/ | x264、x265、LAME、Ogg、Vorbis、Opus、libvpx、WebP、zlib、dav1d、NVIDIA codec headers，19,071,530 字节 |
| metadata/build-sources.json | 每份源码的精确修订、来源、大小、SHA-256 与许可 |
| metadata/main-source-files.json | 主源码逐文件校验清单，脱离 Git 也可核对 |
| build/ | 实际编译、安装、校验、通知及打包脚本；项目源码不在构建时重新下载，无额外源补丁 |
| upstream-build/toolknit-r3/ | 编译器与软件包版本、配置、PE 导入、实际版本/许可输出、工具链声明 |
| LICENSES/ | GPL、实际组件原许可与专利说明、编译工具链运行库声明；源归档保留原始逐文件声明 |
| validation/windows-runtime.json | 对最终 EXE 运行的 Windows 功能测试结果 |
| ffmpeg/、旧固定标签及 LEGACY-GYAN-SOURCE-STATUS.md | 独立保留旧 6.1.1 快照、原 Gyan 构建信息及未解决的材料缺口 |

[构建 42072553824](https://github.com/ZihangDong/toolknit-ffmpeg-sources/actions/runs/42072553824)
使用提交 95439c04417eef49b4a5dcbac484ce921f50d0ab，Ubuntu 24.04 交叉编译成功。
归档提交只增加最终证据、说明及许可整理，不改变该任务的项目源码或编译配置。
一般工具链与系统库独立标识。PE 导入仅含 Windows 系统 DLL；最小系统 PATH 运行通过。
文本证据仅规范换行与空白，版权/许可文字保留。没有宣称第二次完整构建字节完全一致。
Windows MSYS2 备用路线未达到发布验证条件，正式证据使用 Ubuntu 路线。

## 运行包与客户端接入

运行包地址为七彩云固定版本对象：
https://toolknit-downloads-u1ll6equ.cdn.7caiyun.com/runtime/ffmpeg/ffmpeg-6.1.6-toolknit-r3-win32-x64.gz

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| gzip | 14,642,939 | c4f982b2f82dda95e079bd26129435640bc31d36d05308fada77cebc47a61fe3 |
| EXE | 37,815,808 | a2ce68645f7c9d95dfc2bda6814aa432195a83b393ec4c2d58ad1ccc9ae8245a |

匿名 HEAD 200、Range 206（bytes 0-127/14642939）、完整下载及解压哈希全部一致。
直连一次测得约 1.85 MB/s，仅代表这台机器当次网络。
同目录提供版本化 SOURCE、GPL-3.0、THIRD-PARTY、TOOLCHAIN 文本附件，匿名下载与本地逐字节一致。
旧公共对象和旧源码标签保留；运行包不在 GitHub Release 分发。

客户端修改在 native_runtime/dependencies.rs 与 platform/dependency_download.rs，固定新版地址、大小和哈希。
保留原安装目录、环境变量、事件、命令、取消和旧来源参数兼容；来源仍统一七彩云。
下载弹框复用既有 GitHub 图标/安全外链入口。Tauri resources 增加维护构建、组件及工具链声明。
中英文帮助、声明、许可契约及根 changelog 同步；不新增公开命令或存储键。

## 行为验证

scripts/test-ffmpeg-distribution.mjs 对最终 EXE 完成 27 项检查：6 种音频和 8 种视频输出、
音轨提取与剪辑、PNG/JPG 帧、GIF 调色板、裁剪缩放、HEVC/x265、WebP、独立参考编码器生成的 AV1、
Whisper 单声道 16 kHz 预处理、中文路径、重复输出唯一命名、源文件不变和取消。
报告中的 EXE 哈希与公开运行包一致。原型及旧 Gyan 测试只作对照，不冒充最终版本证据。

最终检查：

- 完整 test:release：114 项脚本通过，覆盖架构、安全、许可、CLI/MCP 与发布资源检查。
- 完整 Cargo：319 passed、26 ignored、0 failed；跳过项保留既有实机/交互约定。
- 显式执行 ffmpeg_real_download_extract_and_probe：从固定七彩云地址真实下载、核对大小/哈希、解压、运行版本探测及重复替换通过，约 7.2 秒；测试目录已回收，不改用户已安装运行库。
- 显式设置最终 EXE 路径执行 CLI 原生转写：使用合成语音和已安装模型，JSON/SRT/TXT、取消、并发拒绝、中文路径及源文件保护通过；不下载新模型，不使用私人音频。
- 主源码/依赖归档校验、匿名完整源码包与四份许可附件校验通过；源码包保留构建所需可执行模式，无 EXE/DLL 或私钥文件。
- 外链运行时、帮助中心、依赖/许可契约、架构基线、生产 build 和 git diff --check 通过；工具入口、数量及双语审计无新增缺口。
- 保留既有大 chunk、crypto externalization 和 Windows linker 非阻断提示，未通过隐藏告警冒充修复。

NVENC 编译入口已验证，物理显卡编码/驱动组合未实测。未承诺全部原 Gyan 可选库功能；
本轮保留并验证的是 ToolKnit 使用的产品工作流。

## 维护与授权

独立源码仓库已按用户授权提交、推送并发布固定源码包。上述实现阶段保留本地 V3.3 修改，
未提交/推送桌面代码或发布 V3.3/npm。后续用户授权的测试包见下节。其他模型分发的未完成事项仍见
[下载核查](V33_DOWNLOAD_DISTRIBUTION_AUDIT.zh-CN.md)，不以本轮 FFmpeg 通过替代它们。

## 用户测试包（2026-11-06）

用户随后授权打包，执行 npm run build:test-package -- --bundles nsis 成功。
文件位于 src-tauri/target/release/bundle/nsis/：

- toolknit-desktop_3.3.0_x64-F12-test-20261106-075053-setup.exe
- 57,588,090 字节，SHA-256：da11de2eaab812ff40041f66b455d85324eeb2b8b8598a4fada36edc3ccfa850。
- Windows x64、3.3.0，启用独立 F12 测试配置；生产配置仍关闭 DevTools。
- 实际原生程序已核对 x64 PE、版本、测试标题、新版七彩云 FFmpeg 地址与哈希；NSIS 结构及安装包校验文件已核对。
- 资源清单为 54 项。完整回归沿用本报告上方同份源码的通过结果；打包后资源及差异检查通过。
- 未执行覆盖用户安装或安装后界面验收；没有提交/推送桌面代码、创建桌面 Release 或发布 npm。

本轮仅打包，无新增功能或可复用维护规则；Skill 与根 changelog 无需另增条目。
