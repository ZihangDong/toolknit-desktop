# Windows 安装与 WebView2 验证

以下为 V3.1 的历史验收记录。V3.2 的卸载/覆盖升级修复和最新隔离验证见 [2026-10-22 升级修复记录](WINDOWS_UPGRADE_REPAIR_20261022.zh-CN.md)。

日期：2026-10-14。版本：3.1.0，未发布。修补责任边界为 `src-tauri/windows/installer.nsi`，没有修改应用的 Tauri command、事件、storage key 或版本。

## 修补结果

- 安装前检查系统/当前用户注册表中的有效 WebView2 `pv`；空值、零版本和格式错误不会被视为已安装。保留配置中的最低版本要求。
- `/UPDATE` 也会补装缺失运行时。引导程序退出 0 后重新检测；未检测到运行时则停止安装，不再错误报告成功。
- 区分引导程序启动失败、安装失败和需要重启。失败提供重试及微软官方手工安装页；静默失败返回 1603。
- 返回 3010 时保留重启状态、返回 3010 并提示用户自行重启，禁止完成页或 `/R` 自动启动应用；安装器不会自动重启 Windows。
- 运行时安装器解压到独立的 `$PLUGINSDIR`，避免并发安装共享固定临时文件。
- 多用户初始化保留显式 `/D=` 目标路径。卸载按实际 `ToolKnitDesktop` 名称清理自启动，且只删除指向本次卸载目录的命令；兼容旧名称，不影响其他安装目录。

## 已完成的验证

| 验证 | 结果 |
| --- | --- |
| `npm run test:windows-installer` | 通过：更新补装、安装后复检、重启、目录、自启动与双语契约 |
| `npm run test:windows-installer-native` | 15 个场景通过，执行真实编译的隔离 NSIS 安装器与卸载器 |
| `npm run test:release` | 102 项脚本通过，含 architecture、build、security、CLI/MCP 和产物检查 |
| 安全专项 | 1342 checks 通过 |
| `npm run build:release-package -- --bundles nsis` | 生产安装包编译成功，不启用 QA DevTools |

原生矩阵覆盖：已有真实 WebView2；缺失运行时补装及更新补装；有效版本跳过引导程序；五种零值/畸形版本；退出 0 但运行时缺失；显式失败；无法启动引导程序；运行时未注册/已注册时返回 3010；通过 64 位视图写入的有效用户版本。成功安装核对实际 InstallLocation、生产程序哈希和 qpdf 资源；卸载覆盖自启动项归属与其他安装目录的保护。

测试副本使用独立产品/厂商/Bundle ID、自启动名称、目录和模拟运行时 GUID。仅测试副本将请求权限改为普通用户，并改用 zlib 压缩；保留多用户初始化与安装逻辑，应用 payload 与生产程序一致。应用启动动作替换为文件探针，验证 3010 加 `/R` 时没有启动尝试，避免打开实际用户应用。HKCU 的部分注册表视图在 Windows 上共享，64 位注册场景不宣称已分别覆盖四个互相独立的注册表存储。

缺失运行时、错误码和重启状态使用本地引导程序桩。这验证安装器的分支行为，**不代表已在无 WebView2 的系统中验证微软下载成功或实际重启恢复**。交互重试、UAC、系统级安装、真实微软网络/策略失败仍需下列虚拟机验收。完整 Rust 207 passed / 7 ignored 为前轮结果；本轮未改 Rust 源码，未重复运行完整 Rust 套件。

最终矩阵证据：`tmp/installer-native-7d7d7b0e33ba4a7f9d5bffde5464fce9/results.json`；发布门禁日志：`tmp/windows-installer-release-tests.log`。测试文件不提交、不打进安装包；隔离安装与注册表项已清理，编译脚本及日志保留。

## 当前安装包

路径：`src-tauri/target/release/bundle/nsis/toolknit-desktop_3.1.0_x64-setup.exe`。

- 大小：55,390,726 bytes，约 52.82 MiB。
- SHA-256：`707F1774552F8409B39D9AF9C5BA62ECAB139711727F1AAE8D8F458037793D2B`。
- 签名：NotSigned。本轮没有签名、提交、推送、上传或创建 Release。

配置仍为 `embedBootstrapper`：内置约 1.7 MB 的微软引导程序，**完整运行时仍需联网下载**。网络、代理、防火墙或 Windows 策略可能阻止下载。离线用户可先从微软官方安装 Evergreen Standalone Installer，再运行本安装包；本次没有将完整运行时塞进主安装包。

微软依据：[WebView2 分发文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、[官方运行时下载页](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)。

## 干净虚拟机验收

可以使用 Windows 虚拟机验证。优先选择支持快照与真实重启的 Hyper-V、VMware 或 VirtualBox；Windows Sandbox 适合一次性联网安装冒烟，不能替代持久化的重启/登录场景。

本机为 Windows 10 Pro，硬件支持虚拟化，但 Hypervisor 未运行，没有可用的虚拟机管理器、沙箱或已准备的 Windows 镜像；当前进程也没有启用系统功能所需的管理员权限。本轮没有启用宿主机功能、卸载共享 WebView2、修改用户实际自启动或重启宿主机。

### 基线与快照

1. 准备 Windows 10/11 x64 客户机及独立测试账号。建议 4 vCPU、8 GB RAM、至少 40 GB 虚拟磁盘，并与用户工作资料隔离。
2. 不安装 ToolKnit、WebView2 或会自动带入它的软件。Windows 镜像可能自带 WebView2，不能根据“没有手工安装”认定缺失。
3. 断网建立基线，检查下列系统/用户注册表的两个视图以及 WebView2 Runtime 安装目录。若镜像自带运行时，只在可还原的客户机中卸载；不操作宿主机。
4. 确认没有有效运行时后保存 `no-webview2` 快照。每个缺失场景都从该快照恢复，避免上次安装改变后续结果。
5. 将上面指定哈希的安装包复制进客户机。联网用例再接通网络，避免基线建立期间运行时被其他程序自动安装。

PowerShell 基线检查（只读）：

```powershell
$runtimeKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
foreach ($hive in @('LocalMachine', 'CurrentUser')) {
  foreach ($view in @('Registry32', 'Registry64')) {
    $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    try {
      $key = $root.OpenSubKey($runtimeKey)
      try {
        $pv = if ($key) { $key.GetValue('pv') } else { $null }
        [pscustomobject]@{ Hive = $hive; View = $view; Version = $pv }
      } finally { if ($key) { $key.Dispose() } }
    } finally { $root.Dispose() }
  }
}
```

### 验收矩阵

| 场景 | 必须观察的结果 |
| --- | --- |
| 无运行时、联网安装 | 真实微软引导程序安装成功，安装后有效 pv 出现，ToolKnit 可打开，导航/截图辅助窗口可用 |
| 无运行时、断网 | 不将缺失依赖视为成功；有错误与重试入口，取消后不启动应用 |
| 断网失败后恢复网络并重试 | 同一安装流程可恢复，安装后实际启动验证 |
| 微软官方独立安装器 | 手动安装后重新运行 ToolKnit，依赖被识别，不再重复下载 |
| 普通账号与管理员账号 | 分别检查 UAC、仅当前用户/所有用户安装、目录与对应注册表；凭据切换后还要回原账号验证运行 |
| 缺失运行时的 `/UPDATE` | 在客户机还原为缺失状态后更新，确实执行补装而非跳过 |
| 需要重启 | 如真实微软安装器返回 3010，确认不自动启动、不强制重启；重启后有效运行时与 ToolKnit 启动正常。没有触发该退出码则明确记未覆盖 |
| 自启动与重启登录 | 开启一键记录/自启动、退出并重启客户机，主窗口不抢焦点；托盘、剪贴板监控和截图历史恢复，托盘可唤回主窗口与完整导航 |
| 覆盖安装/卸载 | 核对版本、用户数据保留、快捷方式与指定目录；卸载仅清理归属于该目录的自启动项 |

每项记录 Windows build、账号权限、网络状态、安装器哈希、前后 pv、退出码及实际启动/重启结果。不能仅用退出码 0、注册表存在或浏览器回归代替可用性验收。测试完还原快照。

维护复盘：安装器回归已加入常规契约门禁；执行矩阵需先生产打包，再运行独立原生脚本。PowerShell 5 环境不依赖宿主机自动加载的 `Get-FileHash` 模块，使用 .NET SHA-256 校验 payload；失败清理限于明确隔离身份，避免把测试问题带入用户安装。
