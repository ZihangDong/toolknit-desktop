# PP-OCRv5 移动版模型托管准备

2026-11-06，V3.3（开发中）。本轮仅托管模型、核对许可及准备后续接入资料，没有实现或上线新的 OCR 引擎。

> 本文保留模型托管准备快照；后续 ONNX 接入、功能与实测见 [OCR 实施记录](V33_OCR_IMPLEMENTATION_20261106.zh-CN.md)。

## 固定来源与许可

两个 PaddlePaddle 官方模型卡均声明 Apache-2.0：

- [PP-OCRv5_mobile_det](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det/tree/0d63e78e2b680928f6b1747d76a08db6e645efb7)：修订 0d63e78e2b680928f6b1747d76a08db6e645efb7。
- [PP-OCRv5_mobile_rec](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec/tree/682f20538d8c086cb2128e5cfac775e6c4904e85)：修订 682f20538d8c086cb2128e5cfac775e6c4904e85。

允许按 Apache-2.0 使用、商用、修改及再分发；保留许可、版权和适用的原始声明，修改时作相应标记。本次不修改权重或模型配置，只增加打包、来源清单和说明。

每个包保留官方 README、config.json、inference.json、inference.pdiparams、inference.yml，并附 LICENSE、来源哈希清单和 ToolKnit 打包说明。识别字典/配置随原始文件保留。原模型仓库没有单独 NOTICE 文件；以后复用其他上游代码时，按其适用声明补充。

## 七彩云资源

公开目录前缀：models/ocr/pp-ocrv5-mobile/，位于现有 toolknit-downloads-u1ll6equ 桶。

| 资源 | 字节 | SHA-256 |
| --- | ---: | --- |
| pp-ocrv5-mobile-det-0d63e78e2b68-paddle.tar.gz | 4,542,435 | ef6f104efef6b5a45389785c2f06ec15fb4a35cc644d4c5197ff4d2d992e31a8 |
| pp-ocrv5-mobile-rec-682f20538d8c-paddle.tar.gz | 14,152,292 | 0ab4fb81ca1e123cfc27a5033d69e5b19e14b54dd316708468785c5c10d88d02 |

[资源清单](https://toolknit-downloads-u1ll6equ.cdn.7caiyun.com/models/ocr/pp-ocrv5-mobile/manifest-paddle-20261106.json)提供完整下载地址、准确修订、逐文件哈希、格式与验证状态。同目录还提供 LICENSE-Apache-2.0.txt 和 README-SOURCE-LICENSE.txt；模型包合计 18,694,727 字节，约 18.7 MB。

## 验证与边界

- 官方 LFS 权重的大小和 SHA-256 一致；普通文件与官方 Git blob 身份一致。
- 两个归档各含 8 个文件，内部原始模型文件逐项校验通过。
- 云端 5 个文件上传完成。绕过本机代理进行匿名完整下载，与本地逐字节一致；下载后归档内部权重/配置再次校验通过。
- 检测模型单段 Range 返回 206，Content-Range 为 bytes 0-255/4542435。
- 当前格式是官方 Paddle inference，尚未导出/验证 ONNX，也没有接入 ToolKnit 推理；不能把托管成功算作 OCR 能力验收。没有凭据进入资源包或程序源码。

首轮优先验证模型导出及 Rust/ONNX Runtime 推理，保持官方权重不变，优化图片纠偏、小字处理、长图分块、阅读顺序和低置信度区域的二次识别。只有实测发现模型本身的稳定短板，再评估带标注数据的定向微调。

本轮只新增本维护记录，未修改程序、版本或功能更新日志；不运行无关发布构建。模型格式、字典和推理验收边界已合并至本机 Skill 的原生依赖参考。
