# 贡献指南

感谢你对 ToolKnit Desktop 的兴趣!我们欢迎所有形式的贡献,包括但不限于:

- 提交 Bug 反馈
- 提出新功能建议
- 改进文档
- 提交代码修复或新功能
- 翻译和国际化改进

## 如何贡献

V3.2 的 PDF 转 Word 引擎属于单独授权范围。对该引擎运行、测试、修改或提交衍生代码前，请联系 info@toolknit.com 确认书面授权与贡献条款；一般代码仍按其原许可贡献。提交问题、文字反馈或阅读源码不要求引擎开发授权，完整范围见 [NOTICE](NOTICE)。

### 1. 提交 Issue

在提交 Issue 前,请先搜索是否已有类似问题。如果没有,请使用我们提供的 Issue 模板:

- [Bug 反馈](https://github.com/ZihangDong/toolknit-desktop/issues/new?template=bug_report.yml)
- [功能建议](https://github.com/ZihangDong/toolknit-desktop/issues/new?template=feature_request.yml)

### 2. 提交 Pull Request

1. Fork 本仓库
2. 创建你的功能分支:`git checkout -b feature/amazing-feature`
3. 提交改动:`git commit -m 'Add amazing feature'`
4. 推送到分支:`git push origin feature/amazing-feature`
5. 提交 [Pull Request](https://github.com/ZihangDong/toolknit-desktop/pulls)

### 3. 开发规范

- 保持代码风格一致
- 提交前确保 `npm run tauri build` 能成功构建
- 不要提交敏感信息(API Key、密码、个人凭据等)
- 不要提交大模型文件、ffmpeg.exe、构建产物

### 4. 提交信息规范

提交信息使用中文或英文均可,建议格式:

```
<类型>: <简短描述>

<详细说明(可选)>
```

类型可以是:

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `perf`: 性能优化
- `chore`: 构建/工具相关

## 贡献许可

自 2026-10-14 起，一般代码的新贡献须具有合法授权，并按仓库 LICENSE 所载 PolyForm Noncommercial 1.0.0 提供。单独授权的 PDF 转 Word 引擎贡献须另行书面约定，不因提交 Pull Request 自动转让版权或获得引擎使用许可。贡献者保留自身版权；不要提交未经授权的第三方代码，也不要移除其许可或声明。此前 Apache-2.0 授权及第三方贡献保持原许可不变，详见 NOTICE。此变更不追溯要求旧贡献者重新授权。

## 行为准则

- 尊重每一位贡献者
- 保持友善和建设性的沟通
- 专注问题本身,不做人身攻击

## 联系方式

- GitHub Issues: [https://github.com/ZihangDong/toolknit-desktop/issues](https://github.com/ZihangDong/toolknit-desktop/issues)
- 网页端: [https://toolknit.com](https://toolknit.com)

再次感谢你的贡献!
