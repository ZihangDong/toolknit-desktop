# V3.3 下载资源分发核查（未完成）

2026-11-05 按用户要求将正式下载桶设为公共读；原资源桶仍为私有。公开直链的最终下载、第三方许可和正式发布检查仍在进行。

| 资源 | 已核对的依据 | 发布前待完成 |
| --- | --- | --- |
| FFmpeg 6.1.6-toolknit-r3 Windows 静态构建 | 已切换自有可追溯构建；主源码、11 份精确依赖源码、实际构建脚本、原许可与工具链声明已归档。固定源码 Release 及七彩云运行包匿名完整下载哈希一致；最终 EXE 27 项软件工作流测试通过。 | 本项材料归档与构建已完成，详见[本轮记录](V33_FFMPEG_TRACEABLE_BUILD_20261106.zh-CN.md)。旧 Gyan 构建缺口独立保留，不声称被新材料补齐；物理 GPU 未实测。 |
| Whisper ggml base、small、medium | 上游 Whisper 项目使用 MIT 许可；`ggerganov/whisper.cpp` 模型仓库的模型卡也标注 MIT，三个文件的 LFS SHA-256 与固定值一致。隔离 CLI 环境使用旧 `official` 参数从七彩云安装 Base 成功，完整哈希一致。 | 保留原许可及版权声明；其他型号已检查公开地址，尚未再次完整下载。 |
| LibreOffice 26.2.5 Windows MSI | [官方历史归档](https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.5.2/win/x86_64/LibreOffice_26.2.5.2_Win_x86-64.msi.mirrorlist)列出的完整安装包大小及 SHA-256 与程序固定值一致；[官方源码目录](https://download.documentfoundation.org/libreoffice/src/26.2.5/)提供程序、词典和帮助源码。本机解压版附有 MPL 2.0 及第三方许可说明。七彩云续传完整包后哈希一致。 | 核对完整安装包内许可和全部适用的源码、通知；本机解压目录里的同名 19.8 MB 内部 MSI 不是 372,948,992 字节的原始完整安装包。 |
| MODNet ONNX | 原项目与 Xenova 模型卡标注 Apache-2.0；`onnx/model.onnx` 的大小及 LFS SHA-256 与固定值一致，来源及许可已写入随附声明。公开桶匿名完整下载后 SHA-256 一致。 | 核对上游及传递来源是否存在需要保留的额外声明。 |
| MTranServer 4.0.33 | 上游项目声明 Apache-2.0；官方 Windows x64 release 的大小及 SHA-256 与固定值一致。其 `src/services/engine.ts` 和 `detector.ts` 分别导入 Bergamot 和 CLD2 WASM；对应目录许可分别标注 MPL-2.0 和 Apache-2.0。 | 核对该 Bun 编译制品的完整传递依赖、版权声明、NOTICE 和 MPL 对应源码及其可用性。 |
| Mozilla 翻译模型及词表 | 两个解压后模型哈希与 Mozilla 的 enzh、zhen 模型元数据匹配；enzh 的哈希与[微调模型提交](https://github.com/mozilla/firefox-translations-models/pull/262)的元数据一致，仓库包含 MPL-2.0。 | 逐项核对七个模型、词表和词典的实际来源、权利和适用条款；不能仅凭仓库许可证或训练说明推断全部素材均可再分发。 |

下载源由应用和 CLI 的固定地址提供，不包含云存储凭据；旧来源参数保留兼容，但统一指向七彩云。正式验证还需要检查匿名 HTTPS、禁止重定向、Range 续传、大小及 SHA-256，以及不可用时的失败提示。用户已选择不启用每 IP 限速；公开对象后流量与费用需要在服务商侧监控。

七彩云[存储桶访问说明](https://docs.7caiyun.com/developer/dev-bucket-access)称公共读只允许匿名读取，列举、上传和删除仍需授权；[下载说明](https://docs.7caiyun.com/developer/dev-download)称支持单段 Range。[分享说明](https://docs.7caiyun.com/guide/sharing)说明分享链接指向网页。正式桶 14 个依赖地址匿名 HEAD 返回 200，模型单段 Range 返回 206；匿名列目录和无凭据 PUT 分别返回 403。MODNet、FFmpeg、Whisper Base 和 LibreOffice 已完成公开下载及 SHA-256 校验；其余文件与桌面原生安装流程仍需验证。

应用的更新入口仍打开 `toolknit.com/exe.html`，官网当前安装包链接也仍指向官网域名。该安装包链路尚未迁移到七彩云；V3.3 尚未发布，不能用旧版或测试包假冒将来的正式版本。

历史 Gyan FFmpeg 构建维护者在其他版本的[源码咨询](https://github.com/GyanD/codexffmpeg/issues/246)中要求使用官方邮箱联系；这不是针对本项目 6.1.1 构建的授权或源码答复。可继续寻求可核验的对应源码包，或评估有完整构建材料的替代制品，再执行兼容性回归。

## FFmpeg 当前构建（2026-11-06）

FFmpeg 已完成可追溯构建、完整源码包归档和新版下载引用；当前记录以[本轮构建报告](V33_FFMPEG_TRACEABLE_BUILD_20261106.zh-CN.md)为准。以下保留 11 月 5 日旧 Gyan 快照的历史核查，不代表新版材料仍缺失。

## FFmpeg 独立源码仓库与下载入口（2026-11-05 历史）

- 新建公开仓库 `ZihangDong/toolknit-ffmpeg-sources`，默认分支 `main`，快照标签 `ffmpeg-6.1.1-toolknit-1`。首次推送提交为 `83fed745215ff36aa9fc55301a548d0283b94680`。
- `ffmpeg/` 完整保存官方 `n6.1.1` 对应提交 `e38092ef9395d7049f871ef4d5411eb410e283e0` 的主源码；逐项核验 Git blob，并保留 29 个文件的可执行模式，源码 Git 树为 `dc2cc148dbd7406686d6052c6d414594ad9c5c20`，与官方一致。原 `.gitattributes` 指定的字幕测试夹具 CRLF 按 Git 规范化后核对，不改上游规则。
- 仓库保存原 Gyan README、GPL 正文、实际 EXE 的 `-version` / `-buildconf` 输出、33 项依赖的原始版本字符串，以及可独立运行的源码校验脚本。没有加入应用源码、用户文件、密钥或二进制下载包。
- 本次读取七彩云已校验的 gzip，解压后 EXE 为 `82,797,568` 字节，SHA-256 为 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`；运行结果为 `6.1.1-essentials_build-www.gyan.dev`，包含 `--enable-gpl --enable-version3 --enable-static`。
- 桌面 `ffmpegRuntimeOverlay` 底部复用共享按钮，增加 GitHub 图标和中英文「查看开源源码」。`external-links-runtime.js` 通过既有 URL 校验、Tauri `open_url` / 浏览器安全新窗口路径打开仓库；保留统一 listener 释放和原生打开失败提示，不增加 Tauri command 或 storage key。
- 随附 `Download-Models-Notice.txt` 与中英文帮助声明同步入口。V3.3 根更新日志同步记录。用户授权范围内只推送新源码仓库；桌面仓库修改保留在本地 V3.3。

主源码、依赖版本清单、许可证和源码入口已经可用；完整静态依赖材料仍是独立待补事项。仓库公开及按钮接入不能代替这些材料，也不宣称本项整体已具备正式发布条件。

### 本轮验证

- 独立仓库：本地校验脚本通过；GitHub 远端 `ffmpeg/` 的 tree SHA 与官方一致。固定标签源码 ZIP 的匿名 HTTPS 请求为 200，匿名获取的 `metadata/runtime.json` 与已审查的本地记录一致。
- 外链行为：`test-app-runtimes.mjs` 通过，验证浏览器安全新窗口、Tauri `open_url` 参数、原生失败提示和 dispose 后解除监听。这里的原生命令采用注入替身，没有冒充真实桌面点击。
- 门禁：`test:architecture`、`test-dependency-contract.mjs`、完整 `test:release`（114 项脚本，包含安全、许可与 CLI/MCP 检查）、生产 `build` 和 `git diff --check` 通过。完整 Cargo 测试 319 passed、26 ignored、0 failed；跳过项继续遵循既有实机/交互测试约定。
- 浏览器：完整主题回归通过；依赖管理弹框覆盖中英文、白天/深色、390/720/1400 宽度及低高度，48 组布局无页面异常或焦点警告。源码按钮实际渲染 GitHub 图标并能打开正确仓库地址；模型行是视觉夹具，不进行真实下载安装。
- 维护：根 `changelog.md` 合并本项；本机 Skill 的原生依赖参考补充独立源码仓库、换版本同步材料和保留旧快照的规则，不追加会话流水账。
