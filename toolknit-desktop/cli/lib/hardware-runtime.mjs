import { spawn } from 'node:child_process';
import process from 'node:process';
import os from 'node:os';
import { ToolKnitError, cancellationError, throwIfAborted } from './errors.mjs';

function isWindows() {
  return process.platform === 'win32';
}

function humanBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  const gib = bytes / (1024 ** 3);
  const digits = gib >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(gib)} GB`;
}

function cleanText(value, fallback = 'unknown') {
  const text = String(value ?? '').replace(/\0/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!text) return fallback;
  const compact = text.replace(/\s+/g, ' ');
  const normalized = compact.replace(/[·•]/g, ' ').trim();
  const placeholderPattern = /^(unknown|undefined|not specified|unspecified|to be filled by o\.e\.m\.|system product name|system manufacturer|default string|default|none|null|n\/a|not applicable|generic pnp monitor)$/i;
  if (placeholderPattern.test(normalized)) return fallback;
  if (compact.includes('\uFFFD')) return fallback;
  if (/^(?:\?|\s){2,}$/.test(compact) || /(?:\?){3,}/.test(compact)) return fallback;
  return compact;
}

function summaryText(parts) {
  return parts.filter(Boolean).join(' · ') || 'unknown';
}

function normalizeHardwareStrings(value) {
  if (Array.isArray(value)) return value.map(item => normalizeHardwareStrings(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeHardwareStrings(item)]));
  }
  if (typeof value !== 'string') return value;
  const normalized = value
    .replace(/\0/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.includes('\uFFFD') || /(?:\?){3,}/.test(normalized)) return normalized.includes('?') ? 'unknown' : '';
  return normalized;
}

const HARDWARE_PROVIDER_PREAMBLE = String.raw`
$script:__tkProviderMap = @{}
$script:__tkDcomSession = $null
$script:__tkDcomAttempted = $false

function Get-ToolKnitRegistryInstance {
  param([string]$ClassName)
  switch ($ClassName) {
    'Win32_ComputerSystem' {
      $biosKey = 'HKLM:\HARDWARE\DESCRIPTION\System\BIOS'
      $p = Get-ItemProperty -Path $biosKey -ErrorAction SilentlyContinue
      if (-not $p) { return $null }
      $mfg = [string]$p.SystemManufacturer
      $model = [string]$p.SystemProductName
      if (-not $mfg -and -not $model) { return $null }
      return [PSCustomObject]@{ Manufacturer = $mfg; Model = $model; PCSystemType = $null; TotalPhysicalMemory = $null }
    }
    'Win32_OperatingSystem' {
      $key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
      $p = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
      if (-not $p) { return $null }
      $caption = [string]$p.ProductName
      if (-not $caption) { $caption = 'Windows' }
      $version = if ($p.DisplayVersion) { [string]$p.DisplayVersion } else { [string]$p.ReleaseId }
      return [PSCustomObject]@{
        Caption = $caption
        Version = $version
        BuildNumber = [string]$p.CurrentBuildNumber
        OSArchitecture = if ([Environment]::Is64BitOperatingSystem) { '64-bit' } else { '32-bit' }
        InstallDate = $null
        LastBootUpTime = $null
        FreePhysicalMemory = $null
        TotalVisibleMemorySize = $null
      }
    }
    'Win32_Processor' {
      $base = 'HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor'
      $subkeys = @(Get-ChildItem $base -ErrorAction SilentlyContinue)
      $p = Get-ItemProperty -Path "$base\0" -ErrorAction SilentlyContinue
      if (-not $p) { return $null }
      return [PSCustomObject]@{
        Name = [string]$p.ProcessorNameString
        Manufacturer = [string]$p.VendorIdentifier
        NumberOfCores = $null
        NumberOfLogicalProcessors = [int]$subkeys.Count
        VirtualizationFirmwareEnabled = $null
        SocketDesignation = 'CPU'
        AddressWidth = if ([Environment]::Is64BitOperatingSystem) { 64 } else { 32 }
        MaxClockSpeed = [int]$p.'~MHz'
        CurrentClockSpeed = [int]$p.'~MHz'
        L2CacheSize = $null
        L3CacheSize = $null
        VMMonitorModeExtensions = $null
        SecondLevelAddressTranslationExtensions = $null
        LoadPercentage = $null
      }
    }
    'Win32_BaseBoard' {
      $biosKey = 'HKLM:\HARDWARE\DESCRIPTION\System\BIOS'
      $p = Get-ItemProperty -Path $biosKey -ErrorAction SilentlyContinue
      if (-not $p -or (-not $p.BaseBoardProduct -and -not $p.BaseBoardManufacturer)) { return $null }
      return [PSCustomObject]@{ Manufacturer = [string]$p.BaseBoardManufacturer; Product = [string]$p.BaseBoardProduct; Version = [string]$p.BaseBoardVersion; Status = '' }
    }
    'Win32_BIOS' {
      $biosKey = 'HKLM:\HARDWARE\DESCRIPTION\System\BIOS'
      $p = Get-ItemProperty -Path $biosKey -ErrorAction SilentlyContinue
      if (-not $p) { return $null }
      $relDate = $null
      if ($p.BIOSReleaseDate) {
        try { $relDate = [DateTime]::ParseExact([string]$p.BIOSReleaseDate, 'MM/dd/yyyy', $null) } catch {}
      }
      return [PSCustomObject]@{ Manufacturer = [string]$p.BIOSVendor; SMBIOSBIOSVersion = [string]$p.BIOSVersion; ReleaseDate = $relDate; SMBIOSMajorVersion = $null; SMBIOSMinorVersion = $null }
    }
    default { return $null }
  }
}

function Get-ToolKnitInstance {
  param(
    [Parameter(Position=0)][string]$ClassName,
    [string]$Namespace = 'root\cimv2',
    [string]$Filter = $null
  )
  $key = "$($Namespace):$($ClassName)"
  $cimArgs = @{ ClassName = $ClassName; Namespace = $Namespace; ErrorAction = 'Stop' }
  if ($Filter) { $cimArgs.Filter = $Filter }

  if ($null -eq $script:__tkDcomSession -and -not $script:__tkDcomAttempted) {
    $script:__tkDcomAttempted = $true
    try {
      $opt = New-CimSessionOption -Protocol Dcom -ErrorAction Stop
      $script:__tkDcomSession = New-CimSession -ComputerName localhost -SessionOption $opt -ErrorAction Stop
    } catch {}
  }

  if ($null -ne $script:__tkDcomSession) {
    try {
      $items = @(Get-CimInstance -CimSession $script:__tkDcomSession @cimArgs)
      if ($items.Count -gt 0) { $script:__tkProviderMap[$key] = 'cim-dcom'; if ($items.Count -eq 1) { return $items[0] }; return $items }
    } catch {}
  }

  try {
    $items = @(Get-CimInstance @cimArgs)
    if ($items.Count -gt 0) { $script:__tkProviderMap[$key] = 'cim-wsman'; if ($items.Count -eq 1) { return $items[0] }; return $items }
  } catch {}

  try {
    if (Get-Command Get-WmiObject -ErrorAction SilentlyContinue) {
      $wmiArgs = @{ Class = $ClassName; Namespace = $Namespace; ErrorAction = 'Stop' }
      if ($Filter) { $wmiArgs.Filter = $Filter }
      $items = @(Get-WmiObject @wmiArgs)
      if ($items.Count -gt 0) { $script:__tkProviderMap[$key] = 'wmi'; if ($items.Count -eq 1) { return $items[0] }; return $items }
    }
  } catch {}

  try {
    $item = Get-ToolKnitRegistryInstance -ClassName $ClassName
    if ($null -ne $item) { $script:__tkProviderMap[$key] = 'registry'; return $item }
  } catch {}

  $script:__tkProviderMap[$key] = 'unavailable'
  return
}
`;

const PROVIDER_ATTACH = String.raw`
if ($script:__tkProviderMap -and $script:__tkProviderMap.Count -gt 0) {
  try {
    $__tk_obj = $__toolknit_payload | ConvertFrom-Json
    if ($__tk_obj -is [pscustomobject]) {
      $__tk_prov = [ordered]@{}
      foreach ($__tk_kv in $script:__tkProviderMap.GetEnumerator() | Sort-Object Key) { $__tk_prov[$__tk_kv.Key] = $__tk_kv.Value }
      $__tk_obj | Add-Member -NotePropertyName providers -NotePropertyValue $__tk_prov -Force
      $__toolknit_payload = $__tk_obj | ConvertTo-Json -Depth 8 -Compress
    }
  } catch {}
}
`;

function runWindowsPowerShellJson(script, context, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      throwIfAborted(options.signal);
    } catch (error) {
      reject(error);
      return;
    }
    if (!isWindows()) {
      reject(new ToolKnitError('ENGINE_UNAVAILABLE', `${context} is currently available on Windows only.`));
      return;
    }
    const providerScript = script.replace(/\bGet-CimInstance\b/g, 'Get-ToolKnitInstance');
    const wrappedScript = `
$ErrorActionPreference = 'SilentlyContinue'
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch {}
${HARDWARE_PROVIDER_PREAMBLE}
$__toolknit_payload = & {
${providerScript}
}
if ($null -eq $__toolknit_payload) { $__toolknit_payload = '' }
${PROVIDER_ATTACH}
$__toolknit_text = ($__toolknit_payload | Out-String).Trim()
$__toolknit_bytes = [System.Text.UTF8Encoding]::new($false).GetBytes([string]$__toolknit_text)
$__toolknit_stdout = [Console]::OpenStandardOutput()
$__toolknit_stdout.Write($__toolknit_bytes, 0, $__toolknit_bytes.Length)
`;
    let child;
    let settled = false;
    let aborted = false;
    let stdout = '';
    let stderr = '';
    let forceKillTimer = null;
    const cleanupAbort = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      options.signal?.removeEventListener?.('abort', onAbort);
    };
    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      reject(error);
    };
    const onAbort = () => {
      aborted = true;
      if (!child || child.killed) return;
      try { child.kill('SIGTERM'); } catch {}
      forceKillTimer = setTimeout(() => {
        try {
          if (!child.killed) child.kill('SIGKILL');
        } catch {}
      }, 2500);
      forceKillTimer.unref?.();
    };
    options.signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        wrappedScript
      ], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      rejectOnce(new ToolKnitError('ENGINE_UNAVAILABLE', `${context} could not start.`));
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stdout.length < 16 * 1024 * 1024) stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      if (stderr.length < 65536) stderr += chunk;
    });
    child.once('error', error => {
      if (aborted || options.signal?.aborted) {
        rejectOnce(cancellationError(options.signal));
        return;
      }
      if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
        rejectOnce(new ToolKnitError('ENGINE_UNAVAILABLE', `${context} is unavailable. Install Windows PowerShell 5.1 or enable it in Windows features.`));
      } else {
        rejectOnce(new ToolKnitError('PROCESSING_FAILED', `${context} could not start.`));
      }
    });
    child.once('close', async (code, signal) => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      if (aborted || options.signal?.aborted) {
        reject(cancellationError(options.signal));
        return;
      }
      if (code !== 0 || signal) {
        const details = stderr.trim().replace(/\r?\n/g, ' ');
        reject(new ToolKnitError('PROCESSING_FAILED', details ? `${context} failed: ${details.slice(0, 240)}` : `${context} failed.`));
        return;
      }
      try {
        const payload = String(stdout || '').trim();
        if (!payload) {
          reject(new ToolKnitError('PROCESSING_FAILED', `${context} returned no data.`));
          return;
        }
        resolve(JSON.parse(payload));
      } catch (error) {
        reject(new ToolKnitError('PROCESSING_FAILED', `${context} returned invalid data: ${String(error?.message || error)}`));
      }
    });
  });
}

const OVERVIEW_SCRIPT = String.raw`
$computer = Get-CimInstance Win32_ComputerSystem
$system = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; driver_version = [string]$_.DriverVersion }
})
$disks = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
  [ordered]@{ model = [string]$_.Model; size_bytes = [Int64]$_.Size }
})
$volumes = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' | ForEach-Object {
  [ordered]@{ id = [string]$_.DeviceID; size_bytes = [Int64]$_.Size; free_bytes = [Int64]$_.FreeSpace }
})
$secureBoot = 'unavailable'
try { if (Confirm-SecureBootUEFI) { $secureBoot = 'enabled' } else { $secureBoot = 'disabled' } } catch {}
$bootMode = if (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State') { 'uefi' } else { 'legacy_or_unavailable' }
$tpm = Get-Tpm
$batteries = @(Get-CimInstance Win32_Battery)
[ordered]@{
  device = [ordered]@{
    manufacturer = [string]$computer.Manufacturer
    model = [string]$computer.Model
    device_type = switch ([int]$computer.PCSystemType) {
      1 { 'desktop' }
      2 { 'laptop' }
      3 { 'workstation' }
      4 { 'server' }
      default { 'other' }
    }
  }
  system = [ordered]@{
    caption = [string]$system.Caption
    version = [string]$system.Version
    build = [string]$system.BuildNumber
    architecture = [string]$system.OSArchitecture
    install_at = if ($system.InstallDate) { ([DateTimeOffset]$system.InstallDate).ToUnixTimeMilliseconds() } else { $null }
    boot_at = if ($system.LastBootUpTime) { ([DateTimeOffset]$system.LastBootUpTime).ToUnixTimeMilliseconds() } else { $null }
  }
  core = [ordered]@{
    cpu_name = [string]$cpu.Name
    cpu_cores = [int]$cpu.NumberOfCores
    cpu_threads = [int]$cpu.NumberOfLogicalProcessors
    memory_total_bytes = [Int64]$computer.TotalPhysicalMemory
    memory_available_bytes = [Int64]$system.FreePhysicalMemory * 1024
    gpus = $gpus
    disks = $disks
    volumes = $volumes
  }
  firmware = [ordered]@{
    mainboard = @([string]$board.Manufacturer, [string]$board.Product | Where-Object { $_ } ) -join ' '
    bios_version = [string]$bios.SMBIOSBIOSVersion
    bios_release_at = if ($bios.ReleaseDate) { ([DateTimeOffset]$bios.ReleaseDate).ToUnixTimeMilliseconds() } else { $null }
    boot_mode = $bootMode
    secure_boot = $secureBoot
    tpm_present = [bool]$tpm.TpmPresent
    tpm_ready = [bool]$tpm.TpmReady
    virtualization_enabled = [bool]$cpu.VirtualizationFirmwareEnabled
  }
  battery = [ordered]@{
    status = if ($batteries.Count -gt 0) { 'present' } else { 'not_detected' }
  }
} | ConvertTo-Json -Depth 6 -Compress
`;

const CPU_MEMORY_SCRIPT = String.raw`
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$system = Get-CimInstance Win32_OperatingSystem
$memoryArray = Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1
$memoryModules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
  [ordered]@{
    slot = [string]$_.DeviceLocator
    bank = [string]$_.BankLabel
    manufacturer = [string]$_.Manufacturer
    part_number = [string]$_.PartNumber
    capacity_bytes = [Int64]$_.Capacity
    speed_mhz = [int]$_.Speed
    configured_clock_mhz = [int]$_.ConfiguredClockSpeed
    smbios_memory_type = [int]$_.SMBIOSMemoryType
  }
})
$perfCpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
$perfMemory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object -First 1
$cpuUsage = if ($null -ne $perfCpu -and $null -ne $perfCpu.PercentProcessorTime) { [int]$perfCpu.PercentProcessorTime } else { [int]$cpu.LoadPercentage }
$availableBytes = if ($null -ne $perfMemory -and $null -ne $perfMemory.AvailableBytes) { [Int64]$perfMemory.AvailableBytes } else { [Int64]$system.FreePhysicalMemory * 1024 }
[ordered]@{
  cpu = [ordered]@{
    name = [string]$cpu.Name
    manufacturer = [string]$cpu.Manufacturer
    socket = [string]$cpu.SocketDesignation
    address_width = [int]$cpu.AddressWidth
    cores = [int]$cpu.NumberOfCores
    threads = [int]$cpu.NumberOfLogicalProcessors
    max_clock_mhz = [int]$cpu.MaxClockSpeed
    current_clock_mhz = [int]$cpu.CurrentClockSpeed
    l2_cache_kb = [int]$cpu.L2CacheSize
    l3_cache_kb = [int]$cpu.L3CacheSize
    virtualization_firmware_enabled = [bool]$cpu.VirtualizationFirmwareEnabled
    vm_monitor_extensions = [bool]$cpu.VMMonitorModeExtensions
    slat_extensions = [bool]$cpu.SecondLevelAddressTranslationExtensions
  }
  memory = [ordered]@{
    total_bytes = [Int64]$system.TotalVisibleMemorySize * 1024
    available_bytes = $availableBytes
    slots_reported = [int]$memoryArray.MemoryDevices
    error_correction_code = [int]$memoryArray.MemoryErrorCorrection
    modules = $memoryModules
  }
  current = [ordered]@{
    cpu_usage_percent = $cpuUsage
    memory_available_bytes = $availableBytes
    committed_bytes = if ($null -ne $perfMemory) { [Int64]$perfMemory.CommittedBytes } else { 0 }
    commit_limit_bytes = if ($null -ne $perfMemory) { [Int64]$perfMemory.CommitLimit } else { 0 }
  }
} | ConvertTo-Json -Depth 6 -Compress
`;

const CPU_MEMORY_LIVE_SCRIPT = String.raw`
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$system = Get-CimInstance Win32_OperatingSystem
$perfCpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
$perfMemory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object -First 1
[ordered]@{
  cpu_usage_percent = if ($null -ne $perfCpu -and $null -ne $perfCpu.PercentProcessorTime) { [int]$perfCpu.PercentProcessorTime } else { [int]$cpu.LoadPercentage }
  memory_available_bytes = if ($null -ne $perfMemory -and $null -ne $perfMemory.AvailableBytes) { [Int64]$perfMemory.AvailableBytes } else { [Int64]$system.FreePhysicalMemory * 1024 }
  committed_bytes = if ($null -ne $perfMemory) { [Int64]$perfMemory.CommittedBytes } else { 0 }
  commit_limit_bytes = if ($null -ne $perfMemory) { [Int64]$perfMemory.CommitLimit } else { 0 }
} | ConvertTo-Json -Compress
`;

const GPU_DISPLAY_SCRIPT = String.raw`
function DecodeWmiText($values) {
  if ($null -eq $values) { return '' }
  return (($values | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join '').Trim()
}
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    video_processor = [string]$_.VideoProcessor
    driver_version = [string]$_.DriverVersion
    driver_date = if ($_.DriverDate) { ([DateTime]$_.DriverDate).ToString('yyyy-MM-dd') } else { '' }
  }
})
$basicByInstance = @{}
Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams | Where-Object { $_.Active } | ForEach-Object { $basicByInstance[$_.InstanceName] = $_ }
$connectionByInstance = @{}
Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorConnectionParams | Where-Object { $_.Active } | ForEach-Object { $connectionByInstance[$_.InstanceName] = $_ }
$monitors = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID | Where-Object { $_.Active } | ForEach-Object {
  $basic = $basicByInstance[$_.InstanceName]
  $connection = $connectionByInstance[$_.InstanceName]
  $displayKey = if ([string]$_.InstanceName -match 'DISPLAY\\([^\\]+)') { $Matches[1] } else { '' }
  [ordered]@{
    display_key = $displayKey
    manufacturer = DecodeWmiText $_.ManufacturerName
    model = DecodeWmiText $_.UserFriendlyName
    product_code = DecodeWmiText $_.ProductCodeID
    width_cm = if ($basic) { [int]$basic.MaxHorizontalImageSize } else { 0 }
    height_cm = if ($basic) { [int]$basic.MaxVerticalImageSize } else { 0 }
    connection_code = if ($null -ne $connection -and $null -ne $connection.VideoOutputTechnology) {
      try { [Int64]$connection.VideoOutputTechnology } catch { [Int64]-1 }
    } else { [Int64]-1 }
  }
})
[ordered]@{ gpus = $gpus; monitors = $monitors } | ConvertTo-Json -Depth 5 -Compress
`;

const MAINBOARD_SCRIPT = String.raw`
function Epoch($value) {
  if ($null -eq $value) { return $null }
  try { return ([DateTimeOffset]$value).ToUnixTimeMilliseconds() } catch { return $null }
}
$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$enclosure = Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1
$secureBoot = 'unavailable'
try { if (Confirm-SecureBootUEFI) { $secureBoot = 'enabled' } else { $secureBoot = 'disabled' } } catch {}
$bootMode = if (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State') { 'uefi' } else { 'legacy_or_unavailable' }
$tpm = Get-Tpm
$rawPci = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -like 'PCI\\*' } | Sort-Object PNPClass, Name)
$pciDevices = @($rawPci | Group-Object { "$($_.PNPClass)|$($_.Name)|$($_.Manufacturer)|$($_.Status)|$($_.ConfigManagerErrorCode)" } | ForEach-Object {
  $sample = $_.Group | Select-Object -First 1
  [ordered]@{
    name = [string]$sample.Name
    manufacturer = [string]$sample.Manufacturer
    pnp_class = [string]$sample.PNPClass
    status = [string]$sample.Status
    problem_code = [int]$sample.ConfigManagerErrorCode
    count = [int]$_.Count
  }
} | Select-Object -First 40)
[ordered]@{
  board = [ordered]@{
    manufacturer = [string]$board.Manufacturer
    product = [string]$board.Product
    version = [string]$board.Version
    status = [string]$board.Status
  }
  firmware = [ordered]@{
    manufacturer = [string]$bios.Manufacturer
    bios_version = [string]$bios.SMBIOSBIOSVersion
    release_at = Epoch $bios.ReleaseDate
    smbios_major = [int]$bios.SMBIOSMajorVersion
    smbios_minor = [int]$bios.SMBIOSMinorVersion
    boot_mode = $bootMode
  }
  security = [ordered]@{
    secure_boot = $secureBoot
    tpm_present = [bool]$tpm.TpmPresent
    tpm_ready = [bool]$tpm.TpmReady
    tpm_manufacturer = ([string]$tpm.ManufacturerIdTxt).Trim([char]0)
    virtualization_enabled = [bool]$cpu.VirtualizationFirmwareEnabled
  }
  chassis = [ordered]@{
    types = @($enclosure.ChassisTypes | ForEach-Object { [int]$_ })
    manufacturer = [string]$computer.Manufacturer
    model = [string]$computer.Model
  }
  pci_devices = $pciDevices
} | ConvertTo-Json -Depth 6 -Compress
`;

const STORAGE_SCRIPT = String.raw`
function MaybeInt($value) {
  if ($null -eq $value) { return $null }
  return [Int64]$value
}
$physicalDisks = @(Get-PhysicalDisk)
$physicalById = @{}
foreach ($physical in $physicalDisks) { $physicalById[[string]$physical.DeviceId] = $physical }
$reliabilityById = @{}
if ($physicalDisks.Count -gt 0) {
  foreach ($physical in $physicalDisks) {
    @(Get-StorageReliabilityCounter -PhysicalDisk $physical) | ForEach-Object {
      $reliabilityById[[string]$_.DeviceId] = $_
    }
  }
}
$disks = @(Get-Disk | ForEach-Object {
  $disk = $_
  $physical = $physicalById[[string]$disk.Number]
  if ($null -eq $physical) {
    $physical = $physicalDisks | Where-Object { $_.FriendlyName -eq $disk.FriendlyName } | Select-Object -First 1
  }
  $reliability = if ($physical) { $reliabilityById[[string]$physical.DeviceId] } else { $reliabilityById[[string]$disk.Number] }
  [ordered]@{
    number = [int]$disk.Number
    friendly_name = if ($physical) { [string]$physical.FriendlyName } else { [string]$disk.FriendlyName }
    media_type = if ($physical) { [string]$physical.MediaType } else { '' }
    bus_type = if ($physical) { [string]$physical.BusType } else { [string]$disk.BusType }
    size_bytes = [Int64]$disk.Size
    firmware_version = if ($physical) { [string]$physical.FirmwareVersion } else { '' }
    partition_style = [string]$disk.PartitionStyle
    health_status = if ($physical -and $physical.HealthStatus) { [string]$physical.HealthStatus } else { [string]$disk.HealthStatus }
    operational_status = if ($physical -and $physical.OperationalStatus) { @($physical.OperationalStatus) -join ', ' } else { @($disk.OperationalStatus) -join ', ' }
    is_system = [bool]$disk.IsSystem
    is_boot = [bool]$disk.IsBoot
    is_offline = [bool]$disk.IsOffline
    reliability = [ordered]@{
      temperature_c = if ($reliability -and $null -ne $reliability.Temperature) { MaybeInt $reliability.Temperature } else { $null }
      wear_percent = if ($reliability -and $null -ne $reliability.Wear) { MaybeInt $reliability.Wear } else { $null }
      power_on_hours = if ($reliability -and $null -ne $reliability.PowerOnHours) { MaybeInt $reliability.PowerOnHours } else { $null }
      read_errors_total = if ($reliability -and $null -ne $reliability.ReadErrorsTotal) { MaybeInt $reliability.ReadErrorsTotal } else { $null }
      write_errors_total = if ($reliability -and $null -ne $reliability.WriteErrorsTotal) { MaybeInt $reliability.WriteErrorsTotal } else { $null }
    }
  }
})
$volumes = @(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | Sort-Object DriveLetter | ForEach-Object {
  [ordered]@{
    drive_letter = [string]$_.DriveLetter
    file_system = [string]$_.FileSystem
    size_bytes = [Int64]$_.Size
    free_bytes = [Int64]$_.SizeRemaining
    health_status = [string]$_.HealthStatus
  }
})
[ordered]@{ disks = $disks; volumes = $volumes } | ConvertTo-Json -Depth 6 -Compress
`;

const NETWORK_SCRIPT = String.raw`
function GroupDevices($items) {
  return @($items | Group-Object { "$($_.name)|$($_.manufacturer)|$($_.status)" } | ForEach-Object {
    $sample = $_.Group | Select-Object -First 1
    [ordered]@{
      name = [string]$sample.name
      manufacturer = [string]$sample.manufacturer
      status = [string]$sample.status
      count = [int]$_.Count
    }
  } | Select-Object -First 40)
}
$networkAdapters = @(Get-NetAdapter -IncludeHidden | Where-Object { $_.Status -ne 'Not Present' } | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    description = [string]$_.InterfaceDescription
    status = [string]$_.Status
    link_speed = [string]$_.LinkSpeed
    physical = [bool]$_.HardwareInterface
  }
})
$bluetoothRaw = @(Get-CimInstance Win32_PnPEntity | Where-Object {
  $_.PNPClass -eq 'Bluetooth' -and $_.Present -and $_.Name -notmatch '(?i)(service|profile|enumerator|rfcomm|服务|配置文件|枚举器)'
} | ForEach-Object { [ordered]@{ name = [string]$_.Name; manufacturer = [string]$_.Manufacturer; status = [string]$_.Status } })
$usbRaw = @(Get-CimInstance Win32_PnPEntity | Where-Object {
  $_.PNPClass -eq 'USB' -and $_.Present
} | ForEach-Object { [ordered]@{ name = [string]$_.Name; manufacturer = [string]$_.Manufacturer; status = [string]$_.Status } })
$cameraRaw = @(Get-CimInstance Win32_PnPEntity | Where-Object {
  $_.PNPClass -in @('Camera', 'Image') -and $_.Present
} | ForEach-Object { [ordered]@{ name = [string]$_.Name; manufacturer = [string]$_.Manufacturer; status = [string]$_.Status } })
$audioRaw = @(Get-CimInstance Win32_SoundDevice | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; manufacturer = [string]$_.Manufacturer; status = [string]$_.Status }
})
[ordered]@{
  network_adapters = $networkAdapters
  bluetooth_devices = GroupDevices $bluetoothRaw
  audio_devices = GroupDevices $audioRaw
  usb_devices = GroupDevices $usbRaw
  cameras = GroupDevices $cameraRaw
} | ConvertTo-Json -Depth 6 -Compress
`;

const POWER_SCRIPT = String.raw`
function MaybeInt($value) {
  if ($null -eq $value) { return $null }
  return [Int64]$value
}
function MaybeFloat($value) {
  if ($null -eq $value) { return $null }
  return [double]$value
}
function CelsiusFromAcpi($value) {
  if ($null -eq $value -or [double]$value -le 0) { return $null }
  return [math]::Round(([double]$value / 10.0) - 273.15, 1)
}
function BatteryStatusName($value) {
  switch ([int]$value) {
    1 { 'other' }
    2 { 'unknown' }
    3 { 'fully_charged' }
    4 { 'low' }
    5 { 'critical' }
    6 { 'charging' }
    7 { 'charging_high' }
    8 { 'charging_low' }
    9 { 'charging_critical' }
    10 { 'undefined' }
    11 { 'partially_charged' }
    default { 'unknown' }
  }
}
$activePlan = Get-CimInstance -Namespace root\cimv2\power -ClassName Win32_PowerPlan | Where-Object { $_.IsActive } | Select-Object -First 1
$batteryStatic = @(Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData)
$batteryFull = @(Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity)
$batteries = @(Get-CimInstance Win32_Battery)
$batteryItems = @()
for ($i = 0; $i -lt $batteries.Count; $i++) {
  $battery = $batteries[$i]
  $static = if ($i -lt $batteryStatic.Count) { $batteryStatic[$i] } else { $null }
  $full = if ($i -lt $batteryFull.Count) { $batteryFull[$i] } else { $null }
  $designCapacity = if ($static -and $null -ne $static.DesignedCapacity) { MaybeInt $static.DesignedCapacity } else { $null }
  $fullCapacity = if ($full -and $null -ne $full.FullChargedCapacity) { MaybeInt $full.FullChargedCapacity } else { $null }
  $health = if ($designCapacity -and $designCapacity -gt 0 -and $fullCapacity -and $fullCapacity -gt 0) { [math]::Round(($fullCapacity / $designCapacity) * 100, 0) } else { $null }
  $batteryItems += [ordered]@{
    name = [string]$battery.Name
    status = BatteryStatusName $battery.BatteryStatus
    status_code = MaybeInt $battery.BatteryStatus
    charge_percent = MaybeInt $battery.EstimatedChargeRemaining
    estimated_run_time_min = if ($battery.EstimatedRunTime -and [int]$battery.EstimatedRunTime -lt 71582788) { MaybeInt $battery.EstimatedRunTime } else { $null }
    design_capacity_mwh = $designCapacity
    full_charge_capacity_mwh = $fullCapacity
    health_percent = $health
  }
}
$thermalZones = @(Get-CimInstance -Namespace root\wmi -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object -Begin { $zoneIndex = 0 } -Process {
  $zoneIndex += 1
  [ordered]@{
    name = "ACPI Thermal Zone $zoneIndex"
    source = 'acpi'
    current_c = CelsiusFromAcpi $_.CurrentTemperature
    critical_c = CelsiusFromAcpi $_.CriticalTripPoint
    passive_c = CelsiusFromAcpi $_.PassiveTripPoint
  }
})
$fans = @(Get-CimInstance Win32_Fan | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    status = [string]$_.Status
    desired_speed_rpm = MaybeInt $_.DesiredSpeed
    active_cooling = if ($null -ne $_.ActiveCooling) { [bool]$_.ActiveCooling } else { $null }
  }
})
[ordered]@{
  power_plan = [ordered]@{
    name = if ($activePlan) { [string]$activePlan.ElementName } else { '' }
    caption = if ($activePlan) { [string]$activePlan.Caption } else { '' }
    active = [bool]($activePlan -and $activePlan.IsActive)
  }
  batteries = $batteryItems
  thermal_zones = $thermalZones
  fans = $fans
} | ConvertTo-Json -Depth 6 -Compress
`;

function decorate(tool, data, summary) {
  return { tool, summary, ...normalizeHardwareStrings(data) };
}

function nodeOsBasics() {
  const cpus = os.cpus() || [];
  return {
    hostname: os.hostname() || '',
    platform: os.platform() || 'win32',
    arch: os.arch() || 'x64',
    release: os.release() || '',
    cpu_model: cpus[0]?.model || '',
    cpu_threads: cpus.length || 0,
    totalmem: Number.isFinite(os.totalmem()) ? os.totalmem() : 0,
    freemem: Number.isFinite(os.freemem()) ? os.freemem() : 0
  };
}

function overviewHasCoreData(data) {
  return cleanText(data?.core?.cpu_name) !== 'unknown' || Number(data?.core?.memory_total_bytes) > 0;
}

function cpuMemoryHasCoreData(data) {
  return cleanText(data?.cpu?.name) !== 'unknown' || Number(data?.memory?.total_bytes) > 0;
}

function mergeNodeOsOverview(data) {
  const n = nodeOsBasics();
  const out = { ...(data || {}) };
  let used = false;
  const fill = (target, key, value, ok) => {
    if (!ok(value)) return;
    if (!target) return;
    if (ok(target[key])) return;
    target[key] = value;
    used = true;
  };
  out.device = { ...(out.device || {}) };
  out.system = { ...(out.system || {}) };
  out.core = { ...(out.core || {}) };
  fill(out.device, 'model', n.hostname, v => cleanText(v) !== 'unknown');
  fill(out.system, 'caption', `${n.platform} ${n.release}`, v => cleanText(v) !== 'unknown');
  fill(out.system, 'architecture', n.arch === 'x64' ? '64-bit' : n.arch, v => cleanText(v) !== 'unknown');
  fill(out.core, 'cpu_name', n.cpu_model, v => cleanText(v) !== 'unknown');
  fill(out.core, 'cpu_threads', n.cpu_threads, v => Number(v) > 0);
  fill(out.core, 'memory_total_bytes', n.totalmem, v => Number(v) > 0);
  fill(out.core, 'memory_available_bytes', n.freemem, v => Number(v) > 0);
  if (used) out.providers = { ...(out.providers || {}), 'node-os': 'node-os' };
  return out;
}

function mergeNodeOsCpuMemory(data) {
  const n = nodeOsBasics();
  const out = { ...(data || {}) };
  let used = false;
  const fill = (target, key, value, ok) => {
    if (!ok(value)) return;
    if (!target) return;
    if (ok(target[key])) return;
    target[key] = value;
    used = true;
  };
  out.cpu = { ...(out.cpu || {}) };
  out.memory = { ...(out.memory || {}) };
  out.current = { ...(out.current || {}) };
  fill(out.cpu, 'name', n.cpu_model, v => cleanText(v) !== 'unknown');
  fill(out.cpu, 'threads', n.cpu_threads, v => Number(v) > 0);
  fill(out.memory, 'total_bytes', n.totalmem, v => Number(v) > 0);
  fill(out.memory, 'available_bytes', n.freemem, v => Number(v) > 0);
  fill(out.current, 'memory_available_bytes', n.freemem, v => Number(v) > 0);
  if (used) out.providers = { ...(out.providers || {}), 'node-os': 'node-os' };
  return out;
}

export async function inspectHardwareOverview(options = {}) {
  let data = null;
  let fallback = false;
  try {
    data = await runWindowsPowerShellJson(OVERVIEW_SCRIPT, 'Hardware inspection', options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    data = null;
  }
  if (!data) fallback = true;
  else if (!overviewHasCoreData(data)) fallback = true;
  data = mergeNodeOsOverview(data || {});
  const result = decorate(
    'hardware.overview',
    data,
    summaryText([
      cleanText(data?.device?.manufacturer),
      cleanText(data?.device?.model),
      cleanText(data?.system?.caption),
      cleanText(data?.system?.version),
      cleanText(humanBytes(data?.core?.memory_total_bytes), '')
    ])
  );
  if (fallback) result.fallback = true;
  return result;
}

export async function inspectCpuMemoryInfo(options = {}) {
  let data = null;
  let fallback = false;
  try {
    data = await runWindowsPowerShellJson(CPU_MEMORY_SCRIPT, 'CPU and memory inspection', options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    data = null;
  }
  if (!data) fallback = true;
  else if (!cpuMemoryHasCoreData(data)) fallback = true;
  data = mergeNodeOsCpuMemory(data || {});
  const cpu = data?.cpu || {};
  const memory = data?.memory || {};
  const result = decorate(
    'hardware.cpu-memory',
    data,
    summaryText([
      cleanText(cpu.name),
      cpu.cores && cpu.threads ? `${cpu.cores} cores / ${cpu.threads} threads` : '',
      humanBytes(memory.total_bytes)
    ])
  );
  if (fallback) result.fallback = true;
  return result;
}

export async function inspectCpuMemoryLiveStats(options = {}) {
  const data = await runWindowsPowerShellJson(CPU_MEMORY_LIVE_SCRIPT, 'CPU and memory live stats', options);
  return decorate(
    'hardware.cpu-memory-live-stats',
    data,
    summaryText([
      Number.isFinite(Number(data?.cpu_usage_percent)) ? `CPU ${data.cpu_usage_percent}%` : 'CPU unknown',
      `memory ${humanBytes(data?.memory_available_bytes)} free`
    ])
  );
}

export async function inspectGpuDisplayInfo(options = {}) {
  const data = await runWindowsPowerShellJson(GPU_DISPLAY_SCRIPT, 'GPU and display inspection', options);
  return decorate(
    'hardware.gpu-display',
    data,
    summaryText([
      cleanText(data?.gpus?.[0]?.name),
      humanBytes(data?.dxgi_adapters?.[0]?.dedicated_video_memory),
      data?.monitors?.[0]?.model ? cleanText(data.monitors[0].model) : ''
    ])
  );
}

export async function inspectMainboardFirmwareInfo(options = {}) {
  const data = await runWindowsPowerShellJson(MAINBOARD_SCRIPT, 'Mainboard and firmware inspection', options);
  return decorate(
    'hardware.mainboard-firmware',
    data,
    summaryText([
      cleanText(data?.board?.manufacturer),
      cleanText(data?.board?.product),
      cleanText(data?.firmware?.bios_version)
    ])
  );
}

export async function inspectStorageHealthInfo(options = {}) {
  const data = await runWindowsPowerShellJson(STORAGE_SCRIPT, 'Storage and health inspection', options);
  return decorate(
    'hardware.storage-health',
    data,
    summaryText([
      data?.disks?.length ? `${data.disks.length} disks` : '',
      data?.volumes?.length ? `${data.volumes.length} volumes` : '',
      humanBytes(data?.disks?.reduce((sum, disk) => sum + Math.max(0, Number(disk?.size_bytes) || 0), 0))
    ])
  );
}

export async function inspectNetworkDevicesInfo(options = {}) {
  const data = await runWindowsPowerShellJson(NETWORK_SCRIPT, 'Network and device inspection', options);
  return decorate(
    'hardware.network-devices',
    data,
    summaryText([
      data?.network_adapters?.length ? `${data.network_adapters.length} adapters` : '',
      data?.bluetooth_devices?.length ? `${data.bluetooth_devices.length} bluetooth groups` : '',
      data?.usb_devices?.length ? `${data.usb_devices.length} USB groups` : ''
    ])
  );
}

export async function inspectPowerSensorsInfo(options = {}) {
  const data = await runWindowsPowerShellJson(POWER_SCRIPT, 'Power and sensor inspection', options);
  return decorate(
    'hardware.power-sensors',
    data,
    summaryText([
      cleanText(data?.power_plan?.name),
      data?.batteries?.length ? `${data.batteries.length} batteries` : '',
      data?.thermal_zones?.length ? `${data.thermal_zones.length} thermal zones` : ''
    ])
  );
}
