# TK-016：PDF 转 DWG 可行性与实施边界

核验日期：2026-11-20（Asia/Shanghai）。任务来源：上游 [#136](https://github.com/ZihangDong/toolknit-desktop/issues/136)。本轮完成原清单规定的**前置调研**；桌面 PDF 转 DWG 工具尚未实现，上游议题没有关闭。

**续轮更新：** 已补充并实现 [MIT 引擎的线稿转换原型](PDF_TO_DWG_PROTOTYPE.zh-CN.md)，完成 35 项检查、19 份无引擎诊断的原生 DWG / DXF 验证、19 项 C# 库级修改保存及 6 组字体预览。中文缺字与整段字宽已在样例中修复，随结果提供字体及许可。当前优先候选改为该开源路线，ODA 保留为备选；下文的 ODA 优先结论和 LibreDWG 0.14 失败属于初轮记录，不代表续轮的新结果。商业 SDK 不再是实验前提，但真实图纸、交互式 CAD 对字体的识别和桌面集成仍未验收。

## 结论与决策

PDF 中存在可提取路径，并不代表原始 CAD 图纸能完整恢复。首版可研究将矢量 PDF 转成可编辑的二维几何与文字；扫描图不能承诺自动恢复为 CAD 图元，比例、单位、图层和文字需要明确处理。[1][2]

**当前不接入正式工具入口或自动下载引擎。** 初轮技术评估优先候选为 ODA Drawings SDK 的 PDF 导入模块，须先取得可用 SDK、完成合成与真实图纸精度验证，并确认覆盖本项目分发方式的许可。[3][4] 续轮已将优先候选更新为开源原型，细节见上方更新；商业方案不是已通过的供应商验收。

本轮实测 LibreDWG 0.14 的 Windows x64 包：简单 PDF 路径经有限 DXF 映射后能写出 DWG，R2000 输入的同引擎回读得到一条 25.4 单位长直线和 ASCII 文字；但 R12 / R2000 两种 DXF 输入的往返结果都不能被独立 DXF 解析器正常读取，R12 路线的回读 JSON 也不合法。该链路暂不进入正式分发。失败可能来自写入、回读或 DXF 导出阶段，本轮未定位到具体阶段，**不能由此断言生成的 DWG 一定损坏**。实际 CAD 打开与编辑仍未验证。

交付物：本报告、[机器可读的实测快照](issues/tk016-feasibility.json)、`toolknit-desktop/scripts/research-pdf-to-dwg.py` 和清单中的后续验收条目。没有新增运行时依赖、安装包资源、CLI / MCP 命令或“转换成功”占位入口。

## 输入与输出契约

下表为建议实施范围；不是已交付能力。缺少用户真实图纸与 CAD 目标版本时，不推断其单位、出图比例或业务精度。

| 输入 / 需求 | 首版建议行为 | 不应承诺的结果 |
| --- | --- | --- |
| 矢量 PDF：路径及可读文字 | 显示页预览、转换可支持的直线 / 曲线 / 填充；可映射文字保持文字对象 | 原始块、约束、关联标注、尺寸语义、三维模型的无损恢复 |
| 扫描 PDF：只有图片 | 明确提示“扫描页”；首版拒绝可编辑几何转换，可另行讨论图片底图模式 | OCR 或插入图片即完成可编辑 CAD 转换 |
| 混合页：图片与路径 / 文字并存 | 显示混合提示；必须明确图片保留 / 跳过策略及损失；保留图片时验收所有附属资源 | 因存在边框或页码就判定为完整矢量图纸 |
| 扫描图 + 不可见 OCR 文字层 | 仍归入扫描 / 混合风险；文字层存在不代表线条可编辑 | 以“能搜到文字”作为矢量图判据 |
| 轮廓文字 / SHX 几何 | 默认作为几何；识别与重组文字另列范围 | 任意轮廓都能还原中文 / SHX 文字 |
| 原 PDF 有 OCG 图层 | 在引擎支持且实测后映射图层；处理开关、重名及非法名称 | OCG 一定等于原 CAD 图层 |
| 原 PDF 没有图层 | 按几何 / 文字 / 图片等明确分层并说明来源 | 从颜色猜测原始图层且称为原样恢复 |
| 多页或不同页面比例 | 每个选中页输出独立 DWG；逐页设置 / 确认比例 | 多页无条件合成一个 CAD 模型空间 |
| 密码保护、损坏、空白页 | 密码仅本次使用；错误逐页反馈；空白页明确标记 | 将空文件、仅有文件头或失败后的残留文件记为成功 |

上述扫描、文字与分层边界参考 Autodesk 的 PDF 导入说明；其软件的具体实现并不是本项目实现的保证。[1][2]

### 比例、单位与坐标

- 先区分“纸面尺寸”与“模型尺寸”。建议让用户选择 mm / cm / m / inch，或用两点标定：用户提供已知实际长度，转换因子 = 已知长度 / 两点距离。页中文字写着“1:100”不作为自动确定比例的充分证据。
- 在以 PDF 原始用户空间坐标计量时，纸面毫米 = 坐标长度 × `UserUnit` × 25.4 / 72；再乘已确认的比例分母得到模型毫米。若使用的视口变换已经包含 `UserUnit`，不得再次相乘。本轮 72 点样例为纸面 25.4 mm，`UserUnit=2` 的同长样例为 50.8 mm。[11]
- 必须按完整变换处理内容流 CTM、嵌套 Form、CropBox 非零原点、Rotate 和 UserUnit；不得把浏览器预览的向下 y 轴直接当作 CAD 坐标。明确使用裁剪页的哪个角作为导出原点。
- 记录用户确认的单位、比例、页号与引擎版本。DWG 单位元数据本身不负责恢复原出图比例；Autodesk 也明确其 PDFIMPORT 不采用 INSUNITS 设置，不能直接假定其他引擎沿用该变量。[1]

## 引擎、成本与分发核验

| 路线 | 官方能力与本轮证据 | 许可 / 分发约束 | 本轮决定 |
| --- | --- | --- | --- |
| ODA Drawings SDK + PDF 导入 | 当前官方列出 PDF 导入，FAQ 指向 `TD_PdfImport` / OdaMfcApp 示例；未取得 SDK 试用并运行。[3][4] | 商业会员及具体合同；需核对 PDF 模块、第三方库、激活、运行时文件、fork 二次分发与升级权限。[5] | 首选技术候选，满足授权及精度门槛后再实现 |
| 用户已有 AutoCAD 的 PDFIMPORT / 保存 DWG | 官方支持导入几何、填充、图片与 TrueType 文字；图片可能以 PNG 外部参照存在；本机未运行 AutoCAD。[1][2] | 用户已有授权不等于允许本项目分发 AutoCAD；自动化接口、无人值守许可与版本兼容仍需单独验证 | 可作为用户自带 CAD 的独立方案评估，不作为免依赖内置引擎 |
| 自建有限 PDF → DXF → LibreDWG | 本轮只映射合成页的一条 LINE 和一段 ASCII TEXT；0.14 的 `dxf2dwg` 不能直接输入 PDF；往返互通失败。[7][8] | GPLv3，不能将其替换标注为 MIT；分发二进制需要落实许可证、对应源码等义务；进程隔离不自动解决组合分发问题。[9] | 保留实验，不接入正式包 |
| 自建 PDF → DXF | 本轮 ezdxf 生成的两份输入通过其自检；它们仅是研究中间产物 | ezdxf 为 MIT；PDF 解析和其他依赖各自核对。[10] DXF 与 DWG 是不同交付格式 | 如后续选择独立 DXF 功能，须另立任务，不代替 DWG 验收 |
| ODA 免费 File Converter | 官方限定不同版本的 DWG / DXF 互转，提供 GUI / CLI；不是 PDF 导入器。[6] | 免费下载不视为已获得随本项目重新分发的许可；本轮未下载 / 安装 / 接受其协议 | 排除直接 PDF → DWG 路线 |

ODA 定价页在本次核验时列出：Commercial 首年 USD 3,000、续年 2,250，商业分发有 100 席限制；Sustaining 首年 7,500、续年 4,500，列为无限商业分发。该页同时说明年度订阅终止后失去继续分发 ODA 产品的权利。[5] 面向公开下载的桌面应用不应直接选用有限席位方案；实际费用、PDF 导入模块范围、税费和适用权利以签署合同为准。本轮没有付费、申请试用、提交表单或联系供应商。

**必须核对的具体分发材料：** 生产使用权、PDF 导入模块与第三方依赖清单、可随包分发文件、激活密钥保护 / 离线运行、Windows x64 与目标编译器、最终用户告知、公开源码适配层的边界、fork 与 CLI / MCP 的覆盖范围、订阅终止后现有安装包 / 更新 / 镜像的处理方式。不将 SDK 源码、授权文件或个人试用二进制提交到公共仓库。

## 可复现验证

### 环境与产物

- Windows x64；Python 3.12.14、ReportLab 4.4.9、pypdf 6.21.4、pdfplumber 0.11.9；DWG 中间文件使用独立环境的 ezdxf 1.4.3。最终版本以 JSON 快照的 `runtime` / `engine` 字段为准。
- 实验引擎固定为 **LibreDWG 0.14**，不代表所有后续版本。来自官方 GitHub Release，ZIP 为 12,084,779 字节，SHA-256 为 `1ad7e15344d20b3426c3435b078d82fb84b35062815946b2cca9c5fc9810fea8`，与发布页及 API 的摘要一致。未将摘要校验描述为 GPG 签名验证。[7]
- 脚本不会下载或安装引擎。已下载引擎、Python 虚拟环境、合成 PDF、DXF、DWG、JSON、日志与 PNG 全放在被忽略的 `toolknit-desktop/tmp/tk016/`；均未作为应用资源打包。可提交的实测结果在 `docs/issues/tk016-feasibility.json`。

### 13 类 PDF 样例结果

| 样例 | 实际检查 | 结果 / 证据边界 |
| --- | --- | --- |
| vector | 一条 72 点线与 `Scale 1:1` 文字，无图片 | 可提取直线与文字，作为有限转换实验输入 |
| scan | 一张整页栅格图，无路径 / 字符 | 保留扫描页证据 |
| mixed | 扫描图加一条矢量线 | 同时存在图像与路径，不能归为完整矢量图纸 |
| searchable-scan | 整页图加 `Tr=3` 的不可见文字 | 有文字不等于可编辑图形；路径数为 0 |
| outline-like | 无文字对象的矢量矩形 | 只证明路径存在；不能据此判断是几何还是轮廓字 |
| curves-clipping | 圆的曲线路径、贝塞尔、虚线及裁剪 | 读取两条曲线；未验证 CAD 曲线重建 / 裁剪保真 |
| rotated | Rotate=90 | 元数据读取正确；未做 CAD 坐标转换验收 |
| cropped | CropBox=[36,24,324,216] | 读到非零裁剪原点；未做 CAD 坐标转换验收 |
| user-unit | UserUnit=2 | 读到实际用户单位，并核对纸面长度公式 |
| layers | 一个 OCG 包裹实际内容 | 读到 Geometry 图层；未证明可恢复 CAD 原图层 |
| encrypted | AES-256 PDF | 无密码明确要求密码；用合成密码读取原路径 / 文字 |
| malformed | 非 PDF 内容 | 明确拒绝；控制台出现预期的无效头 / EOF 提示 |
| blank | 空白页 | 路径、图片和字符数均为 0 |

这些检查是已知合成输入的读取实验，**不是生产输入分类器**。图片覆盖面积、不可见对象、Form 嵌套、OCG 可见性、裁剪、字体编码和外观都可能影响分类。文件读取与引擎尝试后逐一核对了源 PDF 哈希，没有修改原件。

### 原生 DWG 实验结果

1. 从 vector 页读取实际线坐标、文字基线和文字大小，转换为纸面 mm，生成各含一条 LINE / 一段 TEXT / `PDF_GEOMETRY` 图层的 R12、R2000 DXF。两份源 DXF 的 ezdxf audit 错误均为 0。R12 不支持导出 INSUNITS；不会将它的单位保留记为通过。
2. 固定目标 `r2000`，分别运行 `dxf2dwg`。两次退出码为 0，文件头均为 `AC1015`；R2000 输入的写入日志同时包含 ERROR 诊断。**退出码和文件头不足以判定成功。**
3. 用同套 LibreDWG 的 `dwgread -O JSON` 回读：R2000 输入可核对一条长度 25.4 的 LINE 和 `Scale 1:1` TEXT；R12 输入虽退出 0，却产生不合法 JSON，单独记为失败。实体回读只证明同引擎能读取对应对象，不等于独立 CAD 验证。
4. `dwg2dxf` 返回 0；ezdxf 1.4.3 分别读取往返 DXF，均抛出 `ValueError: Invalid handle 0.`，未清理句柄或自动修复后冒称通过。因此总体状态为 `not-production-ready`，不是转换验收通过。
5. 将合法 vector.pdf 直接交给 `dxf2dwg`，退出 1 且没有生成输出，确认其不是直接 PDF 导入器。

没有在 AutoCAD / BricsCAD / 其他独立 CAD 中打开并编辑 DWG；没有真实建筑 / 机械 / 中文图纸，没有误差统计、性能基准或商业 SDK 端到端结果。当前证据不足以保证工程精度、字体或跨软件互通性。

### 复跑方式

在 `toolknit-desktop/` 下使用含上述 PDF 库的 Python。无引擎时脚本仍能跑 13 类读取实验，报告中引擎状态为 `not-run`：

```powershell
python scripts/research-pdf-to-dwg.py
```

本机实际使用 Codex 随附 Python 建立独立虚拟环境，随后仅在该虚拟环境安装 `ezdxf==1.4.3`。复跑本轮完整实验：

```powershell
# 前提：在独立 Python 环境安装 reportlab、pypdf[crypto]、pdfplumber、Pillow、ezdxf==1.4.3。
# 从 [7] 下载固定版本 win64 ZIP，核对上述 SHA-256，再解压到下列目录。
& tmp/tk016/python/Scripts/python.exe scripts/research-pdf-to-dwg.py `
  --engine-dir tmp/tk016/libredwg-0.14 `
  --snapshot ../docs/issues/tk016-feasibility.json
```

`--snapshot` 显式指定时才更新跟踪证据；默认只写 `tmp`。脚本的 PDF 断言失败会以非零状态退出；候选引擎互通失败作为研究结果记录在 JSON 中，脚本返回 0 表示实验执行完成，**不表示 DWG 转换通过**。依赖安装和引擎下载在脚本之外，避免复跑时意外安装或重新接受许可。

使用 Poppler 渲染合成样例并目视检查；部分系统字体映射产生替代字体提示，因此不将此次英文样例检查视为中文字体验收。PNG 只是输入样例的显示检查，不是 DWG 输出预览。

## 后续实现任务与验收门槛

原 TK-016 的调研范围完成；后续开发分别保留为未完成子项：

- **TK-016-A / P3 / 待 SDK 与分发授权**：取得候选 SDK 或明确自带 CAD 路线，固定版本、目标 DWG 版本、许可、成本、运行时文件和可分发清单。至少用上述样例及三份已获使用许可的真实图纸验证。未满足前不启用正式转换入口。
- **TK-016-B / P3 / 待开发与真实 CAD 验收**：A 通过后实现 Windows x64 矢量 PDF 首版。建议首版上限单文件 50 MiB、50 页，逐页输出；明确混合页策略，扫描页拒绝可编辑转换。支持选页、比例 / 单位 / 两点标定、图层提示、文字回退、取消、失败重试和结果定位。这些数值是实施提案，需要引擎资源测试后锁定。
- **TK-016-C / P3 / 独立评估**：扫描图矢量化、OCR 文字回填及图形重建。另设引擎、许可、精度与人工修订流程，不能由 TK-016-B 的成功默认完成。

建议验收门槛：

| 项目 | 必须提供的可核对证据 |
| --- | --- |
| 真正 DWG 输出 | 使用独立 CAD 正常打开、保存、重新打开；AUDIT 无不可修复错误；不是重命名 DXF、仅有文件头或整页图片 |
| 可编辑性 | 实际选中 / 修改直线、曲线和文字，统计对象类型；中文与缺字回退明确；不能只凭渲染相似 |
| 比例 / 精度 | 已知两点长度、X/Y 方向与原点可比；覆盖 1:1、1:100、mm / inch、旋转、非零 CropBox、UserUnit。建议先以纸面误差 ≤0.05 mm 或长度相对误差 ≤0.1% 中较宽者作为试验门槛，并针对用户工程要求重新定标；不是工程适用性保证 |
| 图层与混合内容 | 有 / 无 OCG 分别验证；关闭图层不泄出隐藏内容；图片 / 字体附属资源完整且换目录后仍可打开；忽略内容明确列出 |
| 可恢复失败 | 密码错、损坏、超限、空页、超时、取消、磁盘满、同名输出、中文路径、引擎崩溃；不覆盖原件，不发布半成品 |
| 资源与分发 | 小型 / 复杂真实图纸耗时、内存、输出大小、超时与进程清理；干净 Windows 安装、离线运行、升级卸载、依赖校验和许可告知 |

满足条件后的实现沿用 `src/features/lazy-tools.js` 懒加载、现有依赖管理、中英文帮助 / 文案、任务中心、原生受控子进程和唯一文件名输出。建议输出目录 `PDF_To_DWG`，中间产物使用任务独立目录，成功前核验内容与依赖资源；图片外参等多文件输出需整体发布或回滚。复用已有文件边界与进程取消机制，不允许从界面传入任意 shell 命令。CLI / MCP 首版是否同步须在 B 开始时明确，目前没有新增命令。

## 官方资料

以下来源于 2026-11-20 查询；动态页面不视为永久合同或版本承诺。来源间有冲突时，保留冲突并要求固定 SDK 实测。

1. [Autodesk：PDFIMPORT](https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-Core/files/GUID-02D97F82-47EC-4EE8-9429-E9CF6198EF34.htm)；说明对象类型及 INSUNITS 边界，所引为明确年份的产品文档。
2. [Autodesk：Import PDF Dialog Box](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-Core/files/GUID-F94D7059-5B4A-4396-97FE-765B1D037D56.htm)；单页、图片外参、图层与几何推断选项。
3. [ODA：Drawings SDK 格式支持](https://www.opendesign.com/faq/question/which-file-formats-does-drawings-sdk-work) 及 [PDF / PRC FAQ](https://www.opendesign.com/faq/pdf-and-prc-questions)；当前站点确认 PDF 导入及模块示例。搜索还会找到 staging 域名的旧“does not directly support”FAQ，不将其与当前模块能力混为一谈，也不把产品页当作已跑通的证据。
4. [ODA：Drawings 产品页](https://www.opendesign.com/products/drawings) 及 [2025-05 导入更新](https://www.opendesign.com/blog/2025/may/recent-sdk-updates)；当前产品包含 PDF 导入，更新说明有裁剪 / 线宽修正。
5. [ODA：Pricing 与订阅 FAQ](https://www.opendesign.com/pricing)；席位、年度费用和终止后分发说明。签约前仍需核对实际合同与第三方条款。
6. [ODA：File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)；DWG / DXF 版本互转与 CLI 参数。
7. [LibreDWG：0.14 官方 Release](https://github.com/LibreDWG/libredwg/releases/tag/0.14)；Windows 包及摘要。该版已新增 r2004 写入，较新 DWG 版本的实验性与 CRC 问题见该发布说明；本轮只试 r2000。
8. [LibreDWG：固定版本仓库](https://github.com/LibreDWG/libredwg/tree/0.14) 及实际下载程序的 `--help` / `--version`；本机帮助列出 r12 / r14 / r2000 / r2004 写入，不能据旧手册只写“仅支持 R2000”。
9. [LibreDWG：COPYING](https://github.com/LibreDWG/libredwg/blob/0.14/COPYING)；GPLv3 原文。项目自身 MIT 许可不替代第三方许可。
10. [ezdxf：1.4.3 源码与许可](https://github.com/mozman/ezdxf/tree/v1.4.3)；独立 DXF 生成 / 读取，不提供本轮的 DWG 写入。
11. [pypdf：页面变换与用户单位](https://pypdf.readthedocs.io/en/stable/user/cropping-and-transforming.html)；原始空间 1/72 英寸、UserUnit、页面盒与变换边界。
