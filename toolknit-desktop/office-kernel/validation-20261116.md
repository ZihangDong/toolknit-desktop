# 定制内核开发验证记录

2026 年 11 月 16 日，Windows x64，LibreOffice 26.2.5.2，固定上游提交 `cd7284b4cbbfeb507e630c1aac019f4157393acb`。此记录是开发验证，尚未通过发布验收。

## 已完成的实际验证

- Windows 开发运行时编译成功，输出位于 `D:\tk-lo\build\instdir`，未覆盖应用的已安装运行时。
- 两项 C++ 原生测试成功，测试日志为 `OK (2)`，覆盖两类设置的 10 项属性断言。
- 新运行时通过不调用 Python 兼容层的 UNO 属性检查，10 / 10 通过；同版本原版运行时为 6 / 10。
- 补丁管理的 6 项测试通过，覆盖重复准备、相互覆盖的补丁、冲突保护、用户暂存内容保留、校验和与过期构建记录。
- 逐行和坐标检查器的 4 项测试通过。

原生测试日志位于 `D:\tk-lo\build\workdir\CppunitTest\sw_ooxmlimport.test.log`；构建和测试回执分别为 `D:\tk-lo\build-receipt.json`、`D:\tk-lo\test-receipt.json`。UNO 检查报告为 `D:\tk-lo\kernel-import.json`。定制 Writer 模块 SHA-256 为 `d00035ced87002ed632058006dbc34b53864db103746c299fc8260bac8cc9398`。

## 用户样本文档回归

| 样本 | 结果 | 检查范围与限制 |
| --- | --- | --- |
| 论文 | 未通过 | 仍为 36 页、10 张图；绪论截图基准 26 行中，原版 3 行一致，定制内核 7 行一致。纯内核模式与现有应用兼容层组合模式均为 7 / 26。 |
| 开题报告 | 检查点通过 | 单文件和批量转换均为 5 页，第一页仍以“平台管理”结尾，源字符保留，批量部分失败处理通过。尚未证明全页视觉一致。 |
| 任务书 | 未通过 | 严格参考 PDF 比较中，第一页表格内首行文字边界相差 1.38 pt，超过小于 1 pt 的要求。 |

样本仅在本机读取，原文件哈希未改变；个人文档和生成的 PDF 不进入应用仓库。论文诊断报告位于 `D:\tk-lo\stock-current-layout-2\report.json`、`D:\tk-lo\kernel-current-layout\report.json`、`D:\tk-lo\kernel-native-layout\report.json`。

## 剩余工作

`characterSpacingControl` 和 `noPunctuationKerning` 的导入缺口已修复并通过原生验证，但 Writer 当前压缩算法仍会让部分正文段落过早纳入下一行文字。还需验证并实现中西文/中数字间距的分别控制、网格右缩进，以及中文标点压缩与断行的兼容规则。不能用固定字号、边距或字符缩放补偿替代这些规则。

本轮未将开发内核接入正式下载、桌面安装包或 CLI 分发，`visualFidelityApproved=false`。后续应以整份文档逐行、坐标与截图核对作为发布条件，不能用页数或上述有限检查点替代。
