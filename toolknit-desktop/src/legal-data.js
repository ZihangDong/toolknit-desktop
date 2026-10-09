import { getLang } from './i18n.js';

const LEGAL_CONTENT_ZH = {
  'declaration': {
    title: '程序声明',
    html: `<div class="help-doc">
      <h2>程序声明</h2>
      <p>本声明适用于 ToolKnit Desktop 3.1.0 及本仓库发布的 CLI / MCP 组件，用于说明软件性质、数据边界、第三方依赖与责任范围。使用前请结合实际任务阅读；继续使用即表示你理解本声明所述边界。</p>

      <h3>一、软件性质与开源许可</h3>
      <p>ToolKnit Desktop 是面向 Windows 10 / 11（64 位）的免费、本地优先文件工作台。桌面端与 CLI / MCP 的已发布源代码采用 <strong>Apache License 2.0</strong>，你可以在遵守该许可证及仓库 <code>NOTICE</code> 的前提下使用、修改和分发代码。</p>
      <p>ToolKnit 网页端、官网托管服务、域名、服务账号以及 ToolKnit 名称、Logo 和视觉标识不因代码开源而自动获得授权。网页端与桌面开源仓库属于相关但边界独立的产品。</p>

      <h3>二、本地文件处理</h3>
      <p>PDF、PPT、图像、音频、视频、文本、计算器、硬件查看和清理等非 AI 文件能力默认在用户设备上运行，源文件不会上传到 ToolKnit 服务器。输出文件写入用户选择的本地目录，程序默认不覆盖已有文件。</p>
      <p>PPT 转 PDF / 图像会调用本机安装的 LibreOffice 运行时；音视频处理会调用本机 FFmpeg；离线转写会调用本机 Whisper 模型。这些处理仍在本机完成。</p>

      <h3>三、AI 与联网边界</h3>
      <p>只有用户主动执行 AI 文字润色、AI 翻译、AI 文档、AI 表格、PPT 文本 AI 整理、AI PPT 大纲、AI PPT 草稿 / PPTX、转写二次润色或 AI 大文件复核时，程序才会向用户选择并配置的第三方 AI 服务发起请求。</p>
      <ul>
        <li>润色、翻译、文档、表格和 PPT AI 能力会发送用户输入的文字或从本地文件提取出的文字；源文件本体不会上传。</li>
        <li>转写二次润色只发送已识别的字幕文字，不发送音频或视频。</li>
        <li>AI 大文件复核只发送文件名、大小、类别、修改时间、相对目录线索和本地风险理由，不发送文件内容或完整绝对路径。</li>
        <li>第三方 AI 服务如何保存和处理请求，受该服务自己的条款与隐私政策约束，ToolKnit 无法替代其作出保证。</li>
      </ul>

      <h3>四、其他网络访问</h3>
      <p>桌面端不会进行静默行为分析或广告追踪。以下操作可能联网：</p>
      <ul>
        <li>用户在设置中下载 FFmpeg、Whisper 模型或 LibreOffice 时，访问所选的官方源或国内镜像，并进行完整性校验。</li>
        <li>首页获取公开的 GitHub 仓库指标与公开支持记录；请求仅用于展示公开项目数据。</li>
        <li>用户点击网页端、GitHub、Issue 或其他外部链接时，由系统浏览器打开相应网站。</li>
        <li>用户主动调用所配置的 AI 服务时，访问该服务的 API。</li>
      </ul>
      <p>本开源桌面版不提供账户注册、登录或云端收藏同步，也不会把应用内收藏上传到 ToolKnit 服务器。</p>

      <h3>五、本机数据与屏幕取色</h3>
      <p>语言、输出目录、界面偏好、收藏、快捷键、已安装依赖状态和 AI 配置保存在本机应用数据中。AI Key 不会上传给 ToolKnit，但会在用户调用 AI 时作为鉴权信息发送给所选服务；请只在可信设备上配置并妥善保管。</p>
      <p>屏幕取色仅在用户点击启动或触发已配置快捷键后工作。取色期间，程序在内存中读取准星周围的 <strong>21 × 21</strong> 像素区域用于放大预览，并返回中心像素颜色；该像素区域不会保存为文件，也不会上传。</p>

      <h3>六、第三方组件与按需依赖</h3>
      <p>本软件使用 Tauri、Rust、PDF.js、pdf-lib、FFmpeg、Whisper、LibreOffice、JSZip、ExcelJS、Chart.js、Lucide 等开源组件或运行时。相关权利归各自权利人所有，具体版本、源码与许可应以仓库依赖清单、锁文件和第三方声明为准。</p>
      <p>界面默认使用阿里巴巴普惠体 Medium / Bold（Copyright © 2019 Alibaba（中国）有限公司，字体设计：Alibaba Design、汉仪字库）及 Montserrat Regular / Bold（Montserrat Project Authors，依据 SIL Open Font License 1.1 发布）。字体权利归各自权利人所有，完整声明见安装包内 <code>assets/fonts/THIRD_PARTY_FONTS.md</code>。用户自行上传替换的字体由用户确认其使用和分发授权。</p>
      <p>FFmpeg、Whisper 模型和 LibreOffice 不随基础安装包全部内置。下载源、网络速度、磁盘空间、系统策略及第三方发布变化都可能影响安装和运行。</p>

      <h3>七、输出、AI 内容与责任限制</h3>
      <p>请在处理重要文件前保留备份，并在投入实际使用前检查导出的页面、字体、颜色、公式、时间轴、压缩质量和文件完整性。格式转换和压缩可能产生兼容性或质量差异。</p>
      <p>AI 结果可能包含事实、排版、翻译或判断错误，仅供辅助，不构成法律、医疗、财务或其他专业意见。用户应对输入内容的合法性、输出结果的复核及最终用途负责。</p>
      <div class="help-note"><p>在适用法律允许的范围内，本软件按“现状”提供，不对特定用途适用性、持续可用性或无错误运行作出保证。开发者不对因错误操作、未备份、第三方服务变化、依赖故障或不可抗力造成的间接损失承担责任。</p></div>

      <h3>八、知识产权与品牌边界</h3>
      <p>用户处理的文件、数据和依法享有权利的内容仍归用户或相应权利人所有。代码使用权以 Apache License 2.0 为准；该许可不授予 ToolKnit 商标、名称、Logo、视觉识别、官网、域名或托管服务的使用权，也不得冒充官方版本或官方账号。</p>

      <h3>九、捐赠说明</h3>
      <p>捐赠完全自愿，用于 AI 开发与测试、兼容性测试、依赖与镜像验证、文档、安装包发布和开源维护。经作者确认后，赞助者可加入 ToolKnit 灰度体验群，参与版本交流、提前测试和功能建议收集；该群不解锁软件额外功能，也不构成购买、订阅、付费外包、技术支持合同或功能优先排期承诺。</p>

      <h3>十、更新与联系</h3>
      <p>本声明会随功能和数据边界变化而更新。正式版本、源代码和问题反馈请以官方 GitHub 仓库为准；提交问题前请移除文件内容、密钥、密码、完整私人路径等敏感信息。</p>
      <div class="help-note"><p>适用版本：ToolKnit Desktop 3.1.0<br/>最后更新：2026 年 10 月 9 日<br/>开发者：董子航（Zihang Dong）</p></div>
    </div>`
  },

  'usage-policy': {
    title: '使用规范',
    html: `<div class="help-doc">
      <h2>使用规范</h2>
      <p>本规范说明使用 ToolKnit Desktop、CLI 和 MCP 时应遵守的基本规则。无论工具在本地还是通过 AI 服务处理，用户都应确保输入、操作和输出用途合法、安全并获得必要授权。</p>

      <h3>一、合法与授权使用</h3>
      <ul>
        <li>不得利用本软件制作、处理或传播违法、侵权、欺诈、恶意或危害他人的内容。</li>
        <li>处理他人文件、个人信息、商业资料、受版权保护内容或录音录像前，应取得相应授权。</li>
        <li>国家秘密、商业机密、医疗、财务、身份凭证等高敏感资料，应使用符合所属组织要求的设备和流程，不应仅依赖通用工具的技术边界。</li>
      </ul>

      <h3>二、文件处理与输出检查</h3>
      <ul>
        <li>处理重要文件前保留原件和独立备份；不要把唯一副本作为输入。</li>
        <li>导出后检查页数、文字、图片、公式、音画同步、压缩质量和目标格式兼容性，再删除原文件。</li>
        <li>妥善保管 PDF 加密密码。遗忘密码时，ToolKnit 不保证能够恢复内容。</li>
        <li>大文件和高分辨率任务会占用较多 CPU、内存和磁盘空间；处理期间避免强制结束程序或拔出存储设备。</li>
      </ul>

      <h3>三、AI 使用与敏感信息</h3>
      <ul>
        <li>不要在提示词、导入文档或 Agent 对话中粘贴 API Key、账户密码、身份证号、银行卡号或未经授权的敏感信息。</li>
        <li>使用前了解所选 AI 服务的地区、计费、内容与隐私政策，并自行承担第三方服务产生的费用。</li>
        <li>AI 输出必须人工复核，不得把未经核验的内容直接作为专业结论、正式合同、医疗诊断或财务决策。</li>
        <li>不得使用自动化脚本恶意高频调用第三方 AI 服务或依赖镜像。</li>
      </ul>

      <h3>四、清理、硬件与屏幕取色</h3>
      <ul>
        <li>AI 大文件清理会先扫描本地元数据，只有用户勾选并确认后才将文件移入 Windows 回收站。项目、聊天记录、模型和重要资料应逐项复核。</li>
        <li>硬件工具仅用于只读查看系统可返回的信息，不应被当作专业硬件诊断、超频或安全审计工具。</li>
        <li>屏幕取色应只用于用户有权查看的画面。取色完成或不再使用时应退出取色状态，避免误操作。</li>
      </ul>

      <h3>五、按需依赖</h3>
      <ul>
        <li>FFmpeg、Whisper 模型和 LibreOffice 应优先通过 ToolKnit 设置页提供的官方源或国内镜像安装，并等待下载、安装和校验完整结束。</li>
        <li>不要使用来源不明的可执行文件替换受管理运行时。手动配置路径时，用户应自行确认来源、版本和许可证。</li>
        <li>删除运行时会让对应工具暂时不可用，但不会删除用户输出文件。</li>
      </ul>

      <h3>六、CLI / MCP / Agent</h3>
      <ul>
        <li>始终提供明确的输入和输出路径；默认不覆盖已有文件，只有在用户明确授权时才使用覆盖选项。</li>
        <li>密码和 API Key 不应出现在命令参数、Agent 对话、日志、文件名或公开截图中。桌面端密钥不会自动共享给 CLI / MCP。</li>
        <li>让 Agent 先检查输入，再执行或 dry-run；涉及删除、覆盖、批量处理和 AI 调用时，应在提交前复核目标与范围。</li>
        <li>Agent 必须实际调用 ToolKnit 工具并报告真实结果，不得用未经执行的文字答复冒充处理完成。</li>
      </ul>

      <h3>七、开源代码与品牌使用</h3>
      <p>可以依照 Apache License 2.0 使用、修改和分发本仓库代码，并保留许可证与必要声明。不得冒用 ToolKnit 名称、Logo、官网、域名、服务账号或视觉标识把第三方版本包装成官方版本，也不得把恶意软件与 ToolKnit 名义捆绑传播。</p>

      <h3>八、捐赠与反馈</h3>
      <p>捐赠是自愿支持。赞助者可经确认加入灰度体验群，参与提前测试并提交功能建议，但不代表购买功能、获得技术支持合同或优先排期。反馈问题时请提供可复现步骤、版本与已脱敏日志，不要上传包含私人内容的原文件、密钥或密码。</p>

      <h3>九、更新与兼容性</h3>
      <p>桌面端不会静默强制更新。建议从官方 GitHub Releases 获取新版本并核对发布说明；覆盖安装前先从系统托盘完全退出 ToolKnit。系统、驱动、WebView2、第三方格式和运行时变化可能造成兼容差异。</p>

      <h3>十、责任与规范变更</h3>
      <div class="help-note"><p>用户应对输入内容、操作授权、结果复核和最终用途负责。本规范会随当前功能边界更新；继续使用后续版本表示你理解当时版本中展示的最新说明。</p></div>
      <div class="help-note"><p>适用版本：ToolKnit Desktop 3.1.0<br/>最后更新：2026 年 10 月 9 日<br/>开发者：董子航（Zihang Dong）</p></div>
    </div>`
  }
};

const LEGAL_CONTENT_EN = {
  'declaration': {
    title: 'Program Declaration',
    html: `<div class="help-doc">
      <h2>Program Declaration</h2>
      <p>This declaration applies to ToolKnit Desktop 3.1.0 and the CLI / MCP components published in this repository. It explains the software's nature, data boundaries, third-party dependencies, and limits of responsibility. Please read it in the context of your intended task before use.</p>

      <h3>1. Software and Open-Source License</h3>
      <p>ToolKnit Desktop is a free, local-first file workspace for 64-bit Windows 10 / 11. Published source code for the desktop app and CLI / MCP components is licensed under the <strong>Apache License 2.0</strong>. You may use, modify, and distribute that code subject to the license and the repository <code>NOTICE</code>.</p>
      <p>The hosted ToolKnit website, domains, service accounts, ToolKnit name, logos, and visual identity are not automatically licensed with the source code. The hosted web product and the open-source desktop repository are related products with separate boundaries.</p>

      <h3>2. Local File Processing</h3>
      <p>Non-AI PDF, PPT, image, audio, video, text, calculator, hardware-inspection, and cleanup workflows run on the user's device by default. Source files are not uploaded to a ToolKnit server. Outputs are written to a user-selected local directory and existing files are not overwritten by default.</p>
      <p>PPT-to-PDF/image uses a local LibreOffice runtime, audio/video processing uses local FFmpeg, and offline transcription uses a local Whisper model. These operations still happen on the device.</p>

      <h3>3. AI and Network Boundary</h3>
      <p>A request is sent to a user-selected third-party AI provider only when the user explicitly runs AI Polish, AI Translate, AI Document, AI Table, PPT text AI organization, AI PPT outline, AI PPT draft / PPTX, transcription refinement, or AI review in Large File Cleanup.</p>
      <ul>
        <li>Polish, translation, document, table, and PPT AI workflows send user-entered text or text extracted locally from a file; the source file itself is not uploaded.</li>
        <li>Transcription refinement sends recognized subtitle text only, never the source audio or video.</li>
        <li>AI review in Large File Cleanup sends filename, size, category, modification time, relative directory clues, and local risk reasons. It does not send file contents or full absolute paths.</li>
        <li>Retention and processing by an AI provider are governed by that provider's own terms and privacy policy. ToolKnit cannot make guarantees on its behalf.</li>
      </ul>

      <h3>4. Other Network Access</h3>
      <p>The desktop app does not perform silent behavioral analytics or advertising tracking. It may access the network in these cases:</p>
      <ul>
        <li>At the user's request, Settings downloads FFmpeg, Whisper models, or LibreOffice from the selected official source or China mirror and verifies the result.</li>
        <li>The home page reads public GitHub repository metrics and the public support record for display.</li>
        <li>Website, GitHub, Issue, and other external links open in the system browser after the user clicks them.</li>
        <li>An explicitly requested AI action calls the configured AI provider API.</li>
      </ul>
      <p>This open-source desktop edition has no account registration, sign-in, or cloud favorite sync. In-app favorites are not uploaded to a ToolKnit server.</p>

      <h3>5. Local Data and Screen Picker</h3>
      <p>Language, output location, interface preferences, favorites, shortcuts, managed-runtime status, and AI configuration are stored in local application data. An AI key is not uploaded to ToolKnit, but it is sent as authentication to the selected provider when the user makes an AI request. Configure it only on a trusted device.</p>
      <p>The screen picker works only after the user starts it or invokes the configured shortcut. While active, it reads a <strong>21 × 21</strong> pixel region around the crosshair into memory for magnification and returns the center pixel color. That region is not saved as a file or uploaded.</p>

      <h3>6. Third-Party Components and Optional Runtimes</h3>
      <p>The software uses open-source components or runtimes including Tauri, Rust, PDF.js, pdf-lib, FFmpeg, Whisper, LibreOffice, JSZip, ExcelJS, Chart.js, and Lucide. Rights remain with their respective owners. Refer to dependency manifests, lockfiles, and third-party notices for authoritative versions and licenses.</p>
      <p>The default interface uses Alibaba PuHuiTi Medium / Bold (Copyright © 2019 Alibaba (China) Co., Ltd.; font design by Alibaba Design and Hanyi Fonts) and Montserrat Regular / Bold (Montserrat Project Authors, released under the SIL Open Font License 1.1). Rights remain with their respective owners. See <code>assets/fonts/THIRD_PARTY_FONTS.md</code> in the installation for full notices. Users are responsible for confirming rights to any font they upload as a replacement.</p>
      <p>FFmpeg, Whisper models, and LibreOffice are not all bundled with the base installer. Installation can be affected by the selected source, network speed, disk space, system policy, and upstream releases.</p>

      <h3>7. Outputs, AI Content, and Liability</h3>
      <p>Keep a backup of important files and inspect exported pages, fonts, colors, formulas, timelines, compression quality, and file integrity before relying on a result. Conversion and compression may introduce format or quality differences.</p>
      <p>AI output may contain factual, layout, translation, or judgment errors. It is assistance only and is not legal, medical, financial, or other professional advice. The user is responsible for lawful input, review, and final use.</p>
      <div class="help-note"><p>To the extent permitted by applicable law, the software is provided “as is” without a warranty of fitness for a particular purpose, uninterrupted availability, or error-free operation. The developer is not responsible for indirect loss caused by misuse, missing backups, third-party service changes, dependency failures, or force majeure.</p></div>

      <h3>8. Intellectual Property and Brand Boundary</h3>
      <p>Files and data processed by the user remain with the user or their rightful owners. Code rights are governed by Apache License 2.0. That license does not grant rights to ToolKnit trademarks, names, logos, visual identity, official websites, domains, or hosted services, and it does not permit impersonating an official release or account.</p>

      <h3>9. Donations</h3>
      <p>Donations are voluntary support for AI development and testing, compatibility testing, dependency and mirror verification, documentation, package distribution, and open-source maintenance. After confirmation by the author, supporters may join the ToolKnit preview group for release discussion, early testing, and feature-request collection. Group access does not unlock software features or create a purchase, subscription, paid-development contract, support contract, or priority roadmap commitment.</p>

      <h3>10. Updates and Contact</h3>
      <p>This declaration may be updated when features or data boundaries change. Use the official GitHub repository for releases, source code, and issue reports. Remove file contents, keys, passwords, and private full paths from reports before submitting them.</p>
      <div class="help-note"><p>Applies to: ToolKnit Desktop 3.1.0<br/>Last updated: October 9, 2026<br/>Developer: Zihang Dong</p></div>
    </div>`
  },

  'usage-policy': {
    title: 'Usage Policy',
    html: `<div class="help-doc">
      <h2>Usage Policy</h2>
      <p>This policy states the basic rules for ToolKnit Desktop, CLI, and MCP. Whether a task runs locally or uses an AI provider, users must ensure that inputs, actions, and outputs are lawful, safe, and properly authorized.</p>

      <h3>1. Lawful and Authorized Use</h3>
      <ul>
        <li>Do not use the software to create, process, or distribute illegal, infringing, fraudulent, malicious, or harmful content.</li>
        <li>Obtain the required permission before processing another person's files, personal data, business material, copyrighted content, recordings, or video.</li>
        <li>State secrets, trade secrets, medical or financial records, identity documents, and other highly sensitive material require organization-approved devices and procedures; do not rely on a general-purpose tool alone.</li>
      </ul>

      <h3>2. File Processing and Output Review</h3>
      <ul>
        <li>Keep originals and an independent backup before processing important files. Do not use the only copy as input.</li>
        <li>Verify page count, text, images, formulas, synchronization, compression quality, and target-format compatibility before deleting an original.</li>
        <li>Keep PDF encryption passwords safe. ToolKnit does not guarantee recovery if a password is lost.</li>
        <li>Large or high-resolution jobs can use substantial CPU, memory, and disk space. Avoid force-closing the app or disconnecting storage during processing.</li>
      </ul>

      <h3>3. AI Use and Sensitive Information</h3>
      <ul>
        <li>Do not paste API keys, account passwords, government identifiers, bank details, or unauthorized sensitive information into prompts, imported documents, or Agent conversations.</li>
        <li>Review the selected AI provider's regional availability, pricing, content rules, and privacy policy. The user is responsible for third-party charges.</li>
        <li>Review AI output manually. Do not treat unverified output as a professional conclusion, formal contract, medical diagnosis, or financial decision.</li>
        <li>Do not use automation to abuse third-party AI services or runtime mirrors.</li>
      </ul>

      <h3>4. Cleanup, Hardware, and Screen Picking</h3>
      <ul>
        <li>Large File Cleanup scans local metadata first and moves files to the Windows Recycle Bin only after the user selects and confirms them. Review projects, chats, models, and important data item by item.</li>
        <li>Hardware tools are read-only views of information Windows can expose. They are not professional hardware diagnostics, overclocking tools, or security audits.</li>
        <li>Use the screen picker only on content you are authorized to view, and exit picker mode when the task is complete.</li>
      </ul>

      <h3>5. Optional Runtimes</h3>
      <ul>
        <li>Install FFmpeg, Whisper models, and LibreOffice through the verified official source or China mirror offered in Settings, and wait for download, installation, and verification to finish.</li>
        <li>Do not replace a managed runtime with an executable from an untrusted source. Users who configure a path manually are responsible for its source, version, and license.</li>
        <li>Removing a runtime temporarily disables dependent tools but does not delete user output files.</li>
      </ul>

      <h3>6. CLI / MCP / Agent</h3>
      <ul>
        <li>Always provide explicit input and output paths. Existing files are not overwritten by default; use overwrite options only with explicit user authorization.</li>
        <li>Passwords and API keys must not appear in command arguments, Agent conversations, logs, filenames, or public screenshots. Desktop AI settings are not automatically shared with CLI / MCP.</li>
        <li>Ask an Agent to inspect inputs before execution or dry-run. Review targets and scope before deletion, overwrite, batch processing, or AI calls.</li>
        <li>An Agent must actually invoke ToolKnit and report real results. It must not substitute an unexecuted chat response for completed processing.</li>
      </ul>

      <h3>7. Open-Source Code and Brand Use</h3>
      <p>You may use, modify, and distribute repository code under Apache License 2.0 while preserving the license and required notices. Do not use ToolKnit names, logos, websites, domains, service accounts, or visual identity to present a third-party build as official, and do not bundle malware under the ToolKnit name.</p>

      <h3>8. Donations and Feedback</h3>
      <p>Donations are voluntary. Confirmed supporters may join the preview group for early testing and feature requests, but this does not purchase a feature, support contract, or priority scheduling. When reporting a problem, provide reproducible steps, the app version, and sanitized logs. Do not upload source files containing private content, keys, or passwords.</p>

      <h3>9. Updates and Compatibility</h3>
      <p>The desktop app does not silently force updates. Obtain releases from official GitHub Releases and review release notes. Exit ToolKnit completely from the system tray before an in-place upgrade. Windows, drivers, WebView2, third-party formats, and runtime changes may affect compatibility.</p>

      <h3>10. Responsibility and Policy Changes</h3>
      <div class="help-note"><p>Users are responsible for input content, authorization, result review, and final use. This policy may be updated with the current feature boundary; continued use of a later release means you understand the latest policy shown for that release.</p></div>
      <div class="help-note"><p>Applies to: ToolKnit Desktop 3.1.0<br/>Last updated: October 9, 2026<br/>Developer: Zihang Dong</p></div>
    </div>`
  }
};

export function getLegalContent() {
  return getLang() === 'zh' ? LEGAL_CONTENT_ZH : LEGAL_CONTENT_EN;
}

export { LEGAL_CONTENT_ZH, LEGAL_CONTENT_EN };

export default LEGAL_CONTENT_ZH;
