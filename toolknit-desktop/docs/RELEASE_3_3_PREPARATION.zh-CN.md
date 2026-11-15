# V3.3 发布准备

2026-11-15。版本 3.3.0；分支 `V3.3（开发中）`。本轮范围为生产安装包、源码提交与 GitHub 开发分支推送，以及发布材料准备。当前不代表 V3.3 已对外发布。

## 已整理的发布材料

- 根 [changelog](../../changelog.md) 保持未发布状态，按功能合并短句。
- [V3.3 发布说明草稿](../../docs/desktop-update-v3.3-draft.md) 涵盖文件搜索、Word 转 PDF、本地 OCR、扫描 PDF 转 Word、PDF 导出、截图及 MIT 许可。
- `docs/desktop-update.md` 仍保存 V3.2 正式记录；正式发布时再将确认过的 V3.3 文案接入 Release 工作流。
- 桌面源码 75 项工具、12 分类，CLI/MCP 3.3.0 源码 78 项能力。npm 正式版仍为 3.2.0，不能把分支推送写成 npm 已发布。
- 生产使用 `npm run build:release-package -- --bundles nsis`，不合并测试配置、不启用 `qa-devtools`；安装包和 SHA-256 放仓库外输出目录。

## 本轮依赖修正

正式构建前重新查询官方 npm 和 RustSec。常规契约全部通过不代表最新漏洞库也通过；本轮据此修正：

| 依赖 | 当前锁定版本 | 原因 |
| --- | --- | --- |
| hono / @hono/node-server | 4.13.18 / 2.1.8 | 开发用 MCP SDK 的间接依赖补丁；npm 官方审计归零 |
| rusqlite / libsqlite3-sys | 0.41.1 / 0.39.1 | 更新捆绑 SQLite，修复不匹配 WAL 页大小问题 |
| zstd / zstd-safe | 0.13.4 / 7.4.0 | 压缩上下文和缓冲区/内存安全修正 |
| quinn-proto / quinn-udp | 0.11.19 / 0.5.16 | QUIC 帧、重试令牌与接收循环修正 |
| tokio / rustix / async-executor | 1.53.3 / 1.1.6 / 1.14.1 | 异步安全与已撤回依赖修正；包含锁文件的跨平台材料 |

rusqlite 新版显式启用 `fallible_uint`，承接原 u64 查询/写入的有界转换；未修改数据库格式或清理用户数据。相关内部依赖按解析结果更新，最低 Rust 仍为 1.90。未泛化升级产品依赖或变更应用版本。

修正后官方 npm 审计 0 项漏洞；RustSec 漏洞、unsound 和 yanked 门禁通过。保留上游已停止维护的间接库提示，不能将其写成“所有依赖无风险”。RustSec 数据库本次在线检查记录修订 `4ef2df8e806a65e2f1ecc14f56f51249062b23d6`（2026-11-13），最终审计复用该数据库；首次注册表网络超时与后续成功结果分开记录。

## 发布顺序与待办

1. 验收本轮生产安装包，重点复验快捷键框选后 Esc、胶囊搜索、扫描件转 Word 和旧数据保留。
2. 在另一台干净 Windows 上验收首次安装及 V3.2 覆盖升级。缺少 WebView2 时需联网；隔离安装器桩测试不等同真实微软下载、重启与多屏显卡测试。
3. 按 [依赖分发核查](V33_DOWNLOAD_DISTRIBUTION_AUDIT.zh-CN.md) 复核尚未关闭的第三方材料和下载项；FFmpeg 已完成的对应源码材料见 [固定构建记录](V33_FFMPEG_TRACEABLE_BUILD_20261106.zh-CN.md)。本轮未把历史待办改写成已完成。
4. 确认官网下载页可下载同一生产包并核对 SHA-256，再决定合并主分支及正式发布日期。
5. 正式发布时更新 README/英文 README、根 changelog 和 `docs/desktop-update.md` 的发布状态，令 tag 指向主分支中已验证的提交。
6. 用草稿 Release 上传安装包、校验文件与同提交的源码归档，核对服务端大小和 digest 后公开。较高正式标签会触发旧客户端更新提示，因此官网须先就绪。
7. npm CLI/MCP 3.3.0 独立发布：使用经过独立安装验证的归档，再核验 registry 版本、latest 与 integrity；桌面 Release 不代替 npm 发布。

当前用户授权为生产打包、源码提交及开发分支推送。正式标签、公开 Release、main 合并、官网部署及 npm 发布按后续对应指令执行。

## 维护与证据

本机验证日志保留在 Git 忽略的 `tmp/v33-production-*.log/json`。Skill 只在私有目录合并新版数据库整数兼容与验证要点，不加入仓库或安装包。

## 本轮生产产物

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| toolknit-desktop_3.3.0_x64-setup.exe | 58,100,163 | d972fa1891127777468b0bc1d14b160d405363e16eccdb6648ad5a2091d4fd55 |
| toolknit-desktop.exe（程序载荷） | 61,954,048 | c55eb35392495043957ac1c09ced2d125931833052bc8e6238c2dfc519a2aea7 |

两者 ProductVersion 均为 3.3.0、Authenticode 均为 NotSigned。生产程序 PE 为 x64；实际构建 fingerprint 仅含 `custom-protocol` 与 `default`，未启用 QA feature，主窗及辅助窗的生产 DevTools 契约通过。安装包已复制到仓库外的版本输出目录，并复核复制后摘要一致；附 `.sha256`，源码节点以随包构建清单为准。

## 最终验证

- 修正依赖后完整 `test:release`：116 项 npm 脚本通过，包含架构、版本、许可、安全、各工具、独立 CLI 安装与 MCP SDK 互操作；安全契约 2030 项通过。
- 完整 Rust 库测试：332 通过、31 按约定忽略；32 项剪贴板历史、48 项默认文件搜索测试通过。另行显式运行忽略的截图/搜索原生测试，不把忽略项全部算作已执行。
- 真实隐藏 WebView2：100 次截图会话（含 Esc、旧会话、资源释放和冷重建）通过；100 次搜索菜单/折叠循环及截图时辅助窗恢复通过。使用合成素材，不读取私人桌面、不替代多屏/不同显卡验收；本轮并发测试不用于更新性能基准。
- Windows 隔离安装器 20 项通过，覆盖托盘/后台旧程序、文件锁、旧安装目录与记录缺失、WebView2 校验/失败/重启状态。使用独立产品名、目录及注册表；未覆盖用户当前安装，微软缺失运行时场景使用桩。
- 生产程序导入表检查通过：30 项导入，无额外搜索/Qt/Everything/C++ 运行库加载依赖；产物审计为 20 个 public 文件、556 个构建文件、55 项原生资源。
- 官方 npm 审计 0 项；RustSec 漏洞/unsound/yanked 门禁通过；Windows 依赖图及 MSRV Clippy 检查通过。现有 Clippy 风格建议和上游停止维护提示单独保留，未自动改写无关代码。
- 集成严格审计通过：75 工具、12 分类、78 CLI/MCP，双语键与占位符完整。四个主要七彩云运行库 HEAD 均 200、大小正常且无重定向；这不是本轮重新完整下载全部模型的证据。
- 源码清单扫描 1794 个文本文件无常见凭据命中；暂存范围无私有 Skill、密钥文件、用户文档、安装包或测试输出。新文件一并进入差异检查，清理一处末尾空行，未改功能；文档链接及 Skill 校验通过。

本轮保留既有大 chunk、crypto externalization、Windows linker 和静态 CRT 提示。刻意销毁测试 WebView 时有无效 HWND 的 PostMessage 提示，原生测试完整通过；不据此承诺所有设备均无异常。当前没有创建正式标签、发布 Release、更新官网或发布 npm；后续按上方顺序继续。
