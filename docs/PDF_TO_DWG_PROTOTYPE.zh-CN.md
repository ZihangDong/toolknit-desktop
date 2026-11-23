# TK-016-A：PDF 线稿转 DWG 原型

更新：2026-11-20（Asia/Shanghai）。这是在[前置调研](PDF_TO_DWG_RESEARCH.zh-CN.md)之后完成的可运行研究原型，**尚未注册为桌面工具或官方 CLI / MCP 能力**。用户已确认当前没有可用的交互式 CAD、SDK 或真实 PDF 图纸；相关验收继续保留。

## 当前结果

无需商业 SDK，原型已能将受支持的 PDF 线稿写成 **DWG 2018 / AC1032**，每个选中页生成独立文件，实际包含 LINE、三次 SPLINE 和 TEXT 对象。原型使用隔离安装的 `@node-projects/acad-ts@3.9.0`；该包及 C# 校验库 ACadSharp 3.8.35 的原始许可均为 MIT。没有将 LibreDWG 作为应用运行时或新增 npm 生产依赖。

- **35 项检查通过**：选页、mm / inch / m、1:100、旋转、非零 CropBox、UserUnit、内容流仿射变换、三次曲线、中文 / 中英混排、水平压缩 / 拉伸、衬线字高、多页、1200 条线的多分区文件、同名源再次导出、原件哈希、取消及部分失败清理等。
- **19 份真实 DWG 的独立引擎检查通过**：LibreDWG 0.14.9154 回读，再转 DXF 交给 ezdxf 1.4.3；单位、对象数、已知坐标、颜色、文字与曲线控制点核对通过，DXF audit 为 0 错误 / 0 修复，原生引擎无 Warning / ERROR。FontTools / ezdxf 使用实际随附字体核对每段文字的字高、宽度因子和前进宽度，缺字数为 0，宽度数值误差小于 1e-8 绘图单位；这不是工程测量精度保证。
- **19 项程序化修改 / 另存 / 重开通过**：使用 C# ACadSharp 3.8.35，修改直线端点或样条控制点，再保存并重新打开，逐对象比较几何、文字、字高、宽度因子、字体引用和单位；通知为 0，原始 DWG 哈希不变，另存目录保留字体与许可。这是库级操作，**不等于在 AutoCAD / BricsCAD 界面中完成验收**。acad-ts 源自 ACadSharp，因此将两者如实记录为相关实现，独立 C++ 引擎的证据单列。

跟踪证据：[原型验证快照](issues/tk016-prototype.json)、[C# 修改 / 保存快照](issues/tk016-acadsharp.json)、[字体渲染快照](issues/tk016-font-render.json)。初轮的 [LibreDWG 0.14 失败证据](issues/tk016-feasibility.json) 保留，没有改写成成功。

## 支持边界

支持实线直线、闭合轮廓的边线、三次贝塞尔到三次 B 样条的精确控制点映射，以及可映射的横排、非镜像、非斜切文字。正确应用 PDF.js 的完整页面视口变换，再转换为左下原点的 CAD 坐标；视口已经处理 UserUnit，不会二次乘入。单位与比例必须显式提供，不从页内“1:100”等字样推断。

以下内容会**明确拒绝整次转换**，包括已处理的其他页也不发布：图片 / 扫描件、填充、虚线、任意裁剪路径、Form XObject、OCG、非普通文字渲染、透明 / 混合 / 蒙版、注释、超出页面边界的几何及未知绘制操作。空白页也明确拒绝。这些限制使当前能力适合实验线稿，不能宣称支持任意矢量 PDF。

**中文缺字与整段字宽已修复。** 原型不再引用不存在的 `msyh.ttf`，而是随输出原样提供仓库内的 Noto Sans SC TrueType 字体及 OFL 许可。导出前按 Unicode 检查目标字形覆盖，缺字会明确报错；不再以缺字方框作为成功结果。CAD 需要识别随附字体；若没有自动找到，先安装字体或为 `PDF_PORTABLE` 文字样式选择该字体。DWG 本身没有嵌入 TTF，单独传递 DWG 而丢弃字体仍可能触发 CAD 的字体替换。

文字保留内容、基线与角度；源内嵌字体只用于读取 cap-height 度量，不复制字体程序。标准 14 字体使用其 cap-height；其他无法读取度量的字体明确记录字高近似。按源 PDF 的 em 字号换算为 CAD 大写字高，再根据随附字体的实际前进宽度校准 TEXT 宽度因子。文字保持可编辑、左对齐，避免 FIT 对齐在部分渲染器中将字形墨迹边界拉到端点而改变留白。原 PDF 为 Noto 的中文样例与输出采用同一字形程序；其他字体的笔形 / 字重仍会有替代差异，逐字字偶距和复杂塑形不保证原样恢复。文字颜色仍固定为黑色，线宽映射到相近的 CAD 枚举值；没有修改系统字体设置。

几何与文字分别放到 `PDF_GEOMETRY` / `PDF_TEXT`，不声称恢复原 CAD 图层、块、关联标注或三维语义。几何控制点落在页面外时保守拒绝；不会暗中裁掉。当前不提供两点交互标定、绘图软件预览、工程精度承诺或扫描矢量化。

限制为输入 50 MiB、50 页、每页 20 万个操作 / 5 万个输出对象 / 10 万个文字字符，每页 DWG 输出 64 MiB。有文字的结果另含一份约 10.1 MiB 字体，纯几何不附加字体。写入前检查原件哈希；所有页和随附字体 / 许可成功后才将任务独立临时目录发布为带 UUID 的结果目录。同名源重复导出不覆盖旧结果。取消和失败清理只操作本次生成且已核对路径边界的临时目录。

## 两个实际修正

1. **默认字典未初始化。** 仅创建 `CadDocument` 的默认表不足以建立根字典集合。初版输出被 C# 引擎读取后，保存时报缺少 `Standard` MLine 样式。原型现在显式调用 `updateCollections(true, true)`，建立真实默认对象及头部引用；相关的空类表 499 诊断随之消失。
2. **AC18 容器分区计数。** acad-ts 3.9.0 的分区记录包含全部页面映射条目，头部却写入条目数减一，独立引擎提示 `Invalid sections`。原型仅为当前写入实例包裹内部记录方法，检查无 gap 以及预期计数关系，在引擎生成头部 CRC 和加密前改为实际条目数；没有过滤诊断、事后修改输出字节或删除校验和，也没有改动临时 npm 包。包含 1200 条线的多分区文件另做回归。适配器对不认识的内部结构明确失败，不盲目应用。

这些是研究代码中的实例级适配，仍依赖固定版本的内部接口。正式集成前应整理为带来源、许可和版本校验的补丁或采用包含修正的上游版本，并重新做兼容性验证。

## 运行原型

在 `toolknit-desktop/` 包目录内运行。现有项目依赖需已安装；新增 CAD 包仅安装到被忽略的实验目录：

```powershell
npm install --prefix tmp/tk016/acad-ts-research --ignore-scripts --no-audit --no-fund --save-exact @node-projects/acad-ts@3.9.0

node scripts/convert-pdf-to-dwg-prototype.mjs `
  --input "D:/drawings/linework.pdf" `
  --out-dir "D:/drawings/converted" `
  --cad-module tmp/tk016/acad-ts-research/node_modules/@node-projects/acad-ts/dist/index.js `
  --pages 1-3 --unit mm --scale 100
```

示例路径需要换成实际文件。省略 `--pages` 转换所有页；单位可为 `mm`、`m`、`inch`，`--scale` 为 0 到 10000 之间的正数。输出目录中新增 `原文件名-dwg-UUID/`，包含 `page-001.dwg` 等文件以及 `conversion.json`。遇到不支持的内容时进程返回非零，输出错误代码，不发布之前已处理的页。

有文字的结果还包含 `NotoSansSC-Regular.ttf`、`NOTO-SANS-SC-OFL.txt`、`FONT-README.txt`；请整体保留 / 传递。字体原样复制，实际内嵌名称为 **Noto Sans SC Thin**，以字体元数据为准；没有把其他文件重命名伪装成系统雅黑。报告记录字体哈希和每段文字的目标宽度、字高及宽度因子。

CLI 接受 Ctrl+C。PDF 密码可由本次进程的 `TOOLKNIT_CAD_PROTOTYPE_PASSWORD` 环境变量传入；原型验证矩阵没有重新覆盖密码链路，因此不将该入口写为密码功能验收通过。原型不会自动下载引擎、接受 SDK 协议或联系远端转换服务。

## 复跑验证

固定测试依赖：

- npm CAD 包：3.9.0，锁定包摘要见 JSON 快照的 `package.integrity`；安装后的 LICENSE 含 Jochen Kühner / Albert Domenech 的 MIT 告知。
- LibreDWG：官方 **0.14.9154 预发布版** win64 ZIP，13,813,741 字节，SHA-256 `d687c44d1d9cd19574d23b67ff2f0eaa0b04a55759b26e2e80e4e4510d098b05`。已按 GitHub 发布资产摘要核对，只作为隔离验证器，不作为生产引擎选择。
- Python：原调研使用的独立环境，含 PDF 库和 `ezdxf==1.4.3`。
- 可选 C# 检查：NuGet `ACadSharp 3.8.35` 的 `lib/net8.0/ACadSharp.dll`，仅在临时目录解包；PowerShell 7.4 或更高。没有安装 .NET SDK，当前 PowerShell 自带运行时可加载该程序集。

下载后的 GNU ZIP 核对上述摘要，解压到 `tmp/tk016/libredwg-0.14.9154/`；NuGet 包解压到 `tmp/tk016/acadsharp-3.8.35/`。随后执行：

```powershell
node scripts/test-pdf-to-dwg-prototype.mjs --snapshot ../docs/issues/tk016-prototype.json
./scripts/qa-pdf-to-dwg-acadsharp.ps1 -Snapshot ../docs/issues/tk016-acadsharp.json
& tmp/tk016/python/Scripts/python.exe scripts/qa-pdf-dwg-font-render.py --snapshot ../docs/issues/tk016-font-render.json
```

主测试支持 `--cad-module`、`--engine-dir`、`--python` 覆盖路径；基准与快照对应上述固定版本，更换版本须重新核对来源和结果。三条命令分别产生 35 项 / 19 份原生验证、19 项库级修改保存检查及 6 组字体预览。损坏 PDF 拒绝场景可能产生预期的 `Indexing all PDF objects` 提示；DWG 引擎的 Warning / ERROR 会让主检查失败。`scripts/check-pdf-dwg-typography.py` 由主测试调用，检查实际随附字体，不用系统回退字体冒充通过。

每次运行创建新 `tmp/tk016/prototype-qa/run-*/`，避免覆盖上次证据；当前目录名由 `tmp/tk016/prototype-qa/report.json` 的 `artifactRun` 指出。内部保留输入 PDF、实际输出 DWG、GNU JSON / DXF / 日志、C# 另存结果。输入和原始输出哈希都参与验证。C# 脚本再次核对工件路径没有越过该次运行目录。

字体校验使用 Poppler 渲染输入，以 LibreDWG 导出的 DXF 经 ezdxf SVG / Sharp 渲染输出；两侧使用同一完整页面区域和 2400 px 最长边，禁止按内容范围各自缩放。3 组同字体的中文 / 混排 / 旋转样例，在 1 px 光栅边界容差内双向墨迹覆盖为 100%，墨迹边界差不超过 1 px；另外 3 组异字体的英文压缩 / 拉伸预览只校验段宽和字高，不声称笔形相同。比较图在当前 `run-*/font-render/text-comparison.png`。SVG 校验后端按 TrueType 的 nonzero 规则填充字体，避免通用 evenodd 多边形规则在重叠笔画处挖出白缝；未改写 DWG。中文源 PDF 使用完整字体，避免子集字体绘制缺字。

## 接入前仍需完成

TK-016-A 保留未完成：至少三份有使用许可的真实图纸、可用 CAD 中打开 / 编辑 / 保存 / 重开、CAD 对随附字体的实际识别、复杂内容覆盖及资源性能。原型中的中文缺字和段宽校准已有自动化 / 渲染证据；用户已确认没有现成 CAD / 图纸，当前没有把这些证据冒称为交互式实机验证。

TK-016-B 保留待开发：将通过验证的能力接入懒加载工具页、PDF 预览选页、比例 / 单位 / 标定、中英文文案、任务中心、取消 / 重试、依赖或打包及原生结果定位。当前原型的严格内容子集需要明确产品定位，不能直接以“通用 PDF 转 DWG”上线。TK-016-C 扫描矢量化另行评估。

## 固定来源

- [acad-ts 项目与 API](https://github.com/node-projects/acad-ts)；[3.9.0 npm 元数据](https://registry.npmjs.org/@node-projects/acad-ts/3.9.0)。实际包、版本、许可与 SRI 已在隔离安装目录核对。
- [ACadSharp 项目](https://github.com/DomCR/ACadSharp)；[3.8.35 NuGet 包](https://api.nuget.org/v3-flatcontainer/acadsharp/3.8.35/acadsharp.3.8.35.nupkg)。nuspec 指向源码提交 `90c6f871ff6f37a66170316ebd7a736c1b1ca828`，程序集本地哈希保存在快照中。
- [LibreDWG 0.14.9154 官方发布](https://github.com/LibreDWG/libredwg/releases/tag/0.14.9154)；Win64 ZIP 的来源、发布时间与摘要经官方 API 核对。未把本轮使用的预发布快照称为稳定生产版。
