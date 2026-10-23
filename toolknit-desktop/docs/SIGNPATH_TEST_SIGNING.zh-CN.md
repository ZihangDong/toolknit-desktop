# SignPath 测试签名

这条流程用于验证 GitHub 构建、SignPath 请求、下载及验签链路。测试证书不等于正式可信证书，不能把测试签名安装包当作正式签名版发布。

2026-10-23 分支归并说明：仓库仅保留 `main` 后，下述旧测试签名流程因目标分支删除而停用。现有工作流仍锁定旧分支，不会因主分支合并或推送自动发起签名。恢复测试签名需单独调整工作流权限与分支限制；本次仅合并源码，不执行签名。

## 历史配置

- 工作流：根目录 `.github/workflows/test-signing.yml`。
- 源码：`ToolKnit-Desktop-V3.0-正式版` 分支，GitHub 托管 Windows runner。
- SignPath 项目：`toolknit-desktop`；策略固定为 `test-signing`。
- 产物配置：项目默认的单个 PE 文件配置；上传不压缩为 ZIP，签名后也不解压。
- 签名范围：NSIS 安装包外层 EXE。包内主程序和第三方 EXE 不在这次签名范围内。
- 使用生产构建配置，F12 保持关闭。版本号不改变，不创建 Release、不合并 main。

## 历史首次运行步骤

1. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加 `SIGNPATH_API_TOKEN`，值为 SignPath `CI builds` 用户的 API Token。不要将 Token 放入源码、命令行参数或聊天。
2. 将测试工作流推送到上述 V3 分支。工作流与验签脚本的变动才自动触发，普通应用源码推送不会自动请求签名。
3. 打开 Actions → Test signing，检查发布门禁、原生测试、生产构建、上传、SignPath、验签各阶段。
4. 如首次因缺少 Secret 失败，添加后在原运行页点击 Re-run all jobs。GitHub 要求工作流进入默认分支后才可靠提供 Run workflow，因此首次接入使用限定分支和文件路径的 push 触发器。

## 输出与验证

`toolknit-test-signed-<run-id>` 产物包含测试签名安装包、`.sha256`、`verification.json` 和 `provenance.json`。原始未签名 EXE 单独保留 7 天；验签成功的结果保留 14 天。

验证脚本会检查 PE 结构、签名前后有效载荷一致、CMS 密码学签名、SHA-256 Authenticode 摘要、证书有效期和代码签名用途。工作流固定校验 SignPath 项目的测试证书指纹 `6831FA4A3067EDCE07AD33005E16AD0997662B05`，证书轮换后需要独立核对新指纹并更新配置。

Windows 将自签名测试证书的 `CERT_E_UNTRUSTEDROOT`（`0x800B0109`）报告为 `UnknownError`。只有错误消息与操作系统本地化的该错误完全一致、证书指纹匹配、证书为自签名且证书链仅有 `UntrustedRoot` 时才接受；其他未知错误、显式不信任、证书过期或载荷异常仍然拒绝。实际 Windows 状态、消息、证书链状态和 `testCertificateTrustWarning` 会写入报告，不伪装成系统信任。

在本机用 PowerShell 7 复核，可将 SignPath 测试证书页面中的指纹传给 `-ExpectedThumbprint`：

```powershell
./scripts/verify-test-signature.ps1 -SignedPath '<signed.exe>' -UnsignedPath '<unsigned.exe>' -ExpectedThumbprint '<test certificate thumbprint>'
```

脚本不安装证书。不能为了消除测试证书提示，将它添加到用户机器的受信任根。正式签名仍需正式证书有效、生产策略可用和独立发布审核。
