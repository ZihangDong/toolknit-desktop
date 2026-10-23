# CLI / MCP 3.2.0 npm 发布验证

官方包：[@toolknit/cli 3.2.0](https://www.npmjs.com/package/@toolknit/cli/v/3.2.0)。npm 记录发布时间为 `2026-10-23T16:02:46.610Z`，即北京时间 **2026-10-24 00:02:46**；公开 `latest` 标签为 `3.2.0`。

## 安装

```sh
npm install -g @toolknit/cli@3.2.0
toolknit --version
toolknit mcp serve
```

需要 Node.js 22.13.0 或更高版本。CLI 与桌面端独立安装；FFmpeg、LibreOffice 和转写模型按功能另行准备。完整参数见 [77 项能力目录](CLI_CAPABILITIES.md)。

## 归档与来源

发布的是此前完成独立安装验证的同一份归档，没有在上传前重新生成。

- 压缩大小：26,411,168 字节。
- 文件数：2,536，包含公开第三方依赖文件。
- SHA-256：`114e24a9c11e4abbcafb1231edef455587b1f2f1a5a155a46fa5111b85c348bb`。
- npm SHA-1：`3f5868e1086ba327da3c0ea90bb40803f47220e7`。
- npm integrity：`sha512-LaLr8u6ruKt0fub8rpTuf6AD1EVqbC9Pa/00CluXMBcht8a5jLQknrye1BVcBwSOpXCEX5xZXJ0gDi4D35sIrg==`。

官方 registry 的 SHA-1 和 integrity 与待发布归档逐项一致。包内 CLI 源码与桌面正式发布提交 `4edf7ad9a289c0cec8a8fe99cbf9cd7289ca1253` 一致；本次后续提交只同步发布记录及对应版本检查。

## 真实消费验证

从 npm 官方 registry 安装 `@toolknit/cli@3.2.0` 到仓库外的全新目录，使用 Node.js **22.13.0** 执行，结果全部通过：

- CLI 返回 `3.2.0`，能力目录包含 PDF 转 Word。
- 官方 MCP SDK 完成 stdio 初始化，发现 **77 项工具**。
- 实际生成 DOCX，并从 Word XML 核对转换文字；实际生成单页图像 PDF。
- 错误参数返回失败后，下一次请求仍可正常执行。
- 已有 DOCX 不被覆盖，原始 PDF 字节保持不变。
- 安装包包含 PDF 转 Word 专属许可全文、授权联系方式和引擎源文件许可头。
- 实际消费安装的官方 npm 依赖审计：**0 vulnerabilities**。

验收脚本按已安装包的位置解析依赖，兼容 npm 将依赖放在包内或提升至父目录的布局。发布前完整套件、原生运行时及 AI 兼容验证见已有 [CLI/MCP 审计](V32_CLI_MCP_AUDIT_20261022.zh-CN.md)；本次不将它们描述为发布后的重复全量实测。

## 发布状态与许可

npm 上传先返回 HTTP 202 和“正在处理”提示；当时退出码零并不表示可安装。本记录以公开版本、latest、归档校验及安装成功为最终依据。账号二次验证由用户在 npm 官方页面完成，未记录密码、令牌、验证码或恢复码。

PDF 转 Word 引擎保留独立源码阅览许可，项目其余授权与第三方条款见 NOTICE。官方 CLI 正常运行的例外不授予引擎提取、修改或再利用权；商业授权联系 info@toolknit.com。

桌面 v3.2.0 标签、安装器和源码附件保持原始发布快照；GitHub Release 正文补充 npm 已发布状态，不替换附件。
