// Trusted static shells. Runtime hardware values are rendered separately.

const TOOL_SHELLS = Object.freeze({
  overview: Object.freeze({
    prefix: 'hardwareOverview', tag: 'SYSTEM · TOOL PAGE 3.1', body: 'hardware-overview-body', hero: 'hardware-overview-hero', content: 'hardware-overview-content',
    page: 'hardwareOverviewPage', label: 'System Overview', title: '整机概览', subtitle: '本地读取系统与核心硬件信息，不上传任何数据。',
    aria: '整机概览说明', note: '整机状态、本机安全能力与核心硬件信息只读展示。'
  }),
  cpuMemory: Object.freeze({
    prefix: 'hardwareCpuMemory', tag: 'CPU / MEMORY · TOOL PAGE 3.1', body: 'hardware-cpu-memory-body', hero: 'hardware-cpu-memory-hero', content: 'hardware-cpu-memory-content',
    page: 'cpuMemoryPage', label: 'System Monitor', title: 'CPU 与内存', subtitle: '本地读取处理器规格、内存拓扑与当前资源占用。',
    aria: 'CPU 与内存说明', note: '核心、线程、频率、缓存与内存拓扑只读读取。'
  }),
  gpuDisplay: Object.freeze({
    prefix: 'hardwareGpuDisplay', tag: 'GPU / DISPLAY · TOOL PAGE 3.1', body: 'hardware-gpu-display-body', hero: 'hardware-gpu-display-hero', content: 'hardware-gpu-display-content',
    page: 'gpuDisplayPage', label: 'Graphics & Displays', title: '显卡与显示器', subtitle: '本地读取图形适配器、驱动、显存与已连接显示器信息。',
    aria: '显卡与显示器说明', note: '显卡、驱动、显存与显示器状态本机读取。'
  }),
  mainboard: Object.freeze({
    prefix: 'hardwareMainboard', tag: 'BOARD · TOOL PAGE 3.1', body: 'hardware-mainboard-body', hero: 'hardware-mainboard-hero', content: 'hardware-mainboard-content',
    page: 'mainboardPage', label: 'Mainboard & Firmware', title: '主板与固件', subtitle: '本地读取主板、BIOS/UEFI、启动安全能力与 PCI 设备信息。',
    aria: '主板与固件说明', note: '固件、安全启动、TPM 与 PCI 设备只做只读展示。'
  }),
  storage: Object.freeze({
    prefix: 'hardwareStorage', tag: 'STORAGE · TOOL PAGE 3.1', body: 'hardware-storage-body', hero: 'hardware-storage-hero', content: 'hardware-storage-content',
    page: 'storagePage', label: 'Storage & Health', title: '磁盘与健康', subtitle: '本地读取物理磁盘、卷空间与系统实际提供的可靠性计数器。',
    aria: '磁盘与健康说明', note: '磁盘容量、分区与可靠性字段只读取系统暴露信息。'
  }),
  networkDevices: Object.freeze({
    prefix: 'hardwareNetworkDevices', tag: 'DEVICES · TOOL PAGE 3.1', body: 'hardware-network-devices-body', hero: 'hardware-network-devices-hero', content: 'hardware-network-devices-content',
    page: 'networkDevicesPage', label: 'Network & Devices', title: '网络与设备', subtitle: '本地读取网卡、蓝牙、音频、USB 与摄像头设备状态，不显示网络地址。',
    aria: '网络与设备说明', note: '设备清单按类别整理，不显示 IP、MAC 等网络标识。'
  }),
  powerSensors: Object.freeze({
    prefix: 'hardwarePowerSensors', tag: 'POWER · TOOL PAGE 3.1', body: 'hardware-power-sensors-body', hero: 'hardware-power-sensors-hero', content: 'hardware-power-sensors-content',
    page: 'powerSensorsPage', label: 'Power & Sensors', title: '电源与传感器', subtitle: '本地读取电源计划、电池状态与固件实际提供的温度、风扇传感器。',
    aria: '电源与传感器说明', note: '电池、温度、风扇数据取决于固件和驱动暴露能力。'
  })
});

function hardwareSnapshotTemplate(config) {
  const i18n = `home.${config.page}`;
  return `
      <div class="plasma-bg pdf-merge-v2-bg" id="${config.prefix}PlasmaBg"></div>
      <header class="pdf-merge-v2-topbar">
        <div class="settings-v2-topbar-left pdf-merge-v2-topbar-left">
          <button class="settings-v2-back settings-back pdf-merge-v2-back" id="${config.prefix}Back" type="button" data-i18n-title="settings.back" title="返回首页">
            <i data-lucide="arrow-left"></i>
            <span data-i18n="settings.back">返回首页</span>
          </button>
          <span class="pdf-merge-v2-top-tag">${config.tag}</span>
        </div>
        <div class="home-v2-top-actions pdf-merge-v2-top-actions">
          <button class="home-v2-nav-link" type="button" data-home-link="website"><i data-lucide="globe-2"></i><span>网页版本</span></button>
          <button class="home-v2-support-top" type="button" data-open-support><i data-lucide="heart"></i><span>支持作者</span></button>
          <div class="home-v2-window-cluster" aria-label="窗口与设置">
            <button class="home-v2-icon-button" id="${config.prefix}V2Settings" type="button" data-i18n-title="nav.settings" title="设置" aria-label="设置"><i data-lucide="settings"></i></button>
            <div class="home-v2-window-controls" aria-label="窗口控制">
              <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.minimize" title="最小化" data-action="minimize"><i data-lucide="minus"></i></button>
              <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.maximize" title="最大化" data-action="maximize"><i data-lucide="square"></i></button>
              <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.close" title="关闭" data-action="close"><i data-lucide="x"></i></button>
            </div>
          </div>
        </div>
      </header>
      <div class="audio-convert-body pdf-merge-v2-body hardware-v2-body ${config.body}">
        <aside class="pdf-merge-v2-poster hardware-v2-poster ${config.hero}" aria-label="${config.aria}">
          <div class="pdf-merge-v2-poster-kicker" data-i18n="${i18n}.heroLabel">${config.label}</div>
          <h1 class="pdf-merge-v2-title" data-i18n="${i18n}.title">${config.title}</h1>
          <p class="pdf-merge-v2-subtitle" data-i18n="${i18n}.subtitle">${config.subtitle}</p>
          <div class="pdf-merge-v2-poster-note"><span>READ ONLY</span><strong>${config.note}</strong></div>
          <div class="pdf-merge-v2-steps" aria-label="硬件信息读取流程">
            <div class="pdf-merge-v2-step is-active"><span>01</span><div><strong>本机读取</strong><p>调用桌面端安全接口读取系统公开信息。</p></div></div>
            <div class="pdf-merge-v2-step"><span>02</span><div><strong>分类整理</strong><p>按核心参数、设备表格和状态提示分组。</p></div></div>
            <div class="pdf-merge-v2-step"><span>03</span><div><strong>人工判断</strong><p>缺失字段不会猜测，避免误导硬件结论。</p></div></div>
            <div class="pdf-merge-v2-step"><span>04</span><div><strong>刷新更新</strong><p>点击刷新可重新读取当前状态。</p></div></div>
          </div>
        </aside>
        <main class="pdf-merge-v2-workspace hardware-v2-workspace">
          <section class="hardware-v2-panel">
            <div class="hardware-v2-panel-head">
              <div><span class="pdf-merge-v2-section-kicker">LOCAL INSPECTOR</span><h2 data-i18n="${i18n}.title">${config.title}</h2></div>
              <div class="hardware-overview-refresh-row hardware-v2-refresh-row">
                <button class="hardware-overview-refresh hardware-v2-refresh" id="${config.prefix}Refresh" type="button" data-i18n-title="${i18n}.refresh" data-i18n-aria-label="${i18n}.refresh"><i data-lucide="refresh-cw"></i></button>
                <span id="${config.prefix}UpdatedAt" aria-live="polite"></span>
              </div>
            </div>
            <div class="hardware-v2-content ${config.content}" id="${config.prefix}Content" aria-live="polite"></div>
          </section>
        </main>
      </div>
    `;
}

export const hardwareOverviewTemplate = () => hardwareSnapshotTemplate(TOOL_SHELLS.overview);
export const hardwareCpuMemoryTemplate = () => hardwareSnapshotTemplate(TOOL_SHELLS.cpuMemory);
export const hardwareGpuDisplayTemplate = () => hardwareSnapshotTemplate(TOOL_SHELLS.gpuDisplay);
export const hardwareMainboardTemplate = () => hardwareSnapshotTemplate(TOOL_SHELLS.mainboard);
export const hardwareStorageTemplate = () => hardwareSnapshotTemplate(TOOL_SHELLS.storage);
export const hardwareNetworkDevicesTemplate = () => hardwareSnapshotTemplate(TOOL_SHELLS.networkDevices);
export const hardwarePowerSensorsTemplate = () => hardwareSnapshotTemplate(TOOL_SHELLS.powerSensors);
