use super::*;
#[path = "cleanup_guard.rs"]
pub(super) mod cleanup_guard;
#[path = "duplicate_files.rs"]
pub(super) mod duplicate_files;

#[cfg(target_os = "windows")]
pub(super) const HARDWARE_PROVIDER_PREAMBLE: &str = r#"
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
"#;

#[cfg(target_os = "windows")]
pub(super) const PROVIDER_ATTACH: &str = r#"
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
"#;

#[cfg(all(target_os = "windows", debug_assertions))]
pub(super) fn append_hardware_debug(line: &str) {
    use std::io::Write;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join("toolknit-hardware-debug.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(file, "[{}] {}", stamp, line);
    }
}

#[cfg(any(not(target_os = "windows"), not(debug_assertions)))]
pub(super) fn append_hardware_debug(_line: &str) {}

#[cfg(target_os = "windows")]
pub(super) fn run_windows_powershell_json(
    script: &str,
    context: &str,
) -> Result<serde_json::Value, String> {
    use std::os::windows::process::CommandExt;

    let provider_script = script.replace("Get-CimInstance", "Get-ToolKnitInstance");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let out_path = std::env::temp_dir().join(format!(
        "toolknit-hw-out-{}-{}.txt",
        std::process::id(),
        stamp
    ));
    let err_path = std::env::temp_dir().join(format!(
        "toolknit-hw-err-{}-{}.txt",
        std::process::id(),
        stamp
    ));
    let cleanup_paths = || {
        let _ = std::fs::remove_file(&out_path);
        let _ = std::fs::remove_file(&err_path);
    };

    // Write the JSON payload to a temporary file instead of stdout. This avoids
    // fragile console/stdout encoding issues on some Windows builds, and lets us
    // capture a real exception message when the probe fails.
    let wrapped_script = format!(
        r#"
$ErrorActionPreference = 'Stop'
try {{
{0}
$__toolknit_payload = & {{
{1}
}}
if ($null -eq $__toolknit_payload) {{ $__toolknit_payload = '' }}
{2}
$__toolknit_text = ($__toolknit_payload | Out-String).Trim()
Set-Content -LiteralPath $env:TOOLKNIT_HW_OUT -Value ([string]$__toolknit_text) -Encoding UTF8
}} catch {{
Set-Content -LiteralPath $env:TOOLKNIT_HW_ERR -Value $_.Exception.ToString() -Encoding UTF8
exit 1
}}
"#,
        HARDWARE_PROVIDER_PREAMBLE, provider_script, PROVIDER_ATTACH,
    );

    let output = match std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &wrapped_script,
        ])
        .env("TOOLKNIT_HW_OUT", &out_path)
        .env("TOOLKNIT_HW_ERR", &err_path)
        .creation_flags(0x08000000)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            cleanup_paths();
            return Err(format!("Cannot start {}: {}", context, error));
        }
    };

    if !output.status.success() || !out_path.exists() {
        let err_text = std::fs::read_to_string(&err_path)
            .unwrap_or_default()
            .trim_start_matches('\u{FEFF}')
            .trim()
            .to_string();
        let err_flat = err_text.replace(['\r', '\n'], " ");
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let exit = output.status.code().unwrap_or(-1);
        let detail = if !err_flat.is_empty() {
            format!(
                "exit={}; error={}",
                exit,
                err_flat.chars().take(700).collect::<String>()
            )
        } else if !stderr.is_empty() {
            format!(
                "exit={}; stderr={}",
                exit,
                stderr.chars().take(480).collect::<String>()
            )
        } else {
            format!("exit={}", exit)
        };
        append_hardware_debug(&format!(
            "{} | exit={} | error={} | stderr={}",
            context, exit, err_text, stderr
        ));
        cleanup_paths();
        return Err(format!("{} failed: {}", context, detail));
    }

    let payload = match std::fs::read_to_string(&out_path) {
        Ok(payload) => payload.trim_start_matches('\u{FEFF}').trim().to_string(),
        Err(error) => {
            cleanup_paths();
            return Err(format!("{} failed to read output: {}", context, error));
        }
    };
    cleanup_paths();

    if payload.is_empty() {
        append_hardware_debug(&format!("{} | returned no data", context));
        return Err(format!("{} returned no data", context));
    }
    serde_json::from_str(&payload).map_err(|error| {
        append_hardware_debug(&format!(
            "{} | invalid json: {} | payload={}",
            context, error, payload
        ));
        format!("{} returned invalid data: {}", context, error)
    })
}

#[tauri::command]
pub(super) async fn get_hardware_overview() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_hardware_overview)
        .await
        .map_err(|error| format!("Hardware inspection worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
pub(super) fn collect_hardware_overview() -> Result<serde_json::Value, String> {
    // A single read-only PowerShell/CIM request avoids a chain of WMI calls on
    // the UI thread. The payload deliberately excludes serial numbers, UUIDs,
    // account names, MAC addresses, and any other machine-identifying values.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
# Windows PowerShell 5.1 otherwise writes non-ASCII JSON using the active
# console code page. The Rust process correctly expects UTF-8 JSON.
function Epoch($value) {
  if ($null -eq $value) { return $null }
  try { return [long](($value).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalMilliseconds) } catch { return $null }
}
function DeviceType($value) {
  switch ([int]$value) {
    1 { 'desktop' }
    2 { 'laptop' }
    3 { 'workstation' }
    4 { 'server' }
    default { 'other' }
  }
}
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
$tpm = $null
try { $tpm = Get-Tpm } catch {}
$batteries = @(Get-CimInstance Win32_Battery)
[ordered]@{
  device = [ordered]@{
    manufacturer = [string]$computer.Manufacturer
    model = [string]$computer.Model
    device_type = DeviceType $computer.PCSystemType
  }
  system = [ordered]@{
    caption = [string]$system.Caption
    version = [string]$system.Version
    build = [string]$system.BuildNumber
    architecture = [string]$system.OSArchitecture
    install_at = Epoch $system.InstallDate
    boot_at = Epoch $system.LastBootUpTime
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
    bios_release_at = Epoch $bios.ReleaseDate
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
"#;

    run_windows_powershell_json(SCRIPT, "Windows hardware inspection")
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_hardware_overview() -> Result<serde_json::Value, String> {
    Err("Hardware inspection is currently available on Windows only".to_string())
}

#[tauri::command]
pub(super) async fn get_cpu_memory_info() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_cpu_memory_info)
        .await
        .map_err(|error| format!("CPU and memory inspection worker failed: {}", error))?
}

#[tauri::command]
pub(super) async fn get_cpu_memory_live_stats() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_cpu_memory_live_stats)
        .await
        .map_err(|error| format!("CPU and memory live stats worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
pub(super) fn collect_cpu_memory_info() -> Result<serde_json::Value, String> {
    // Keep identifiers private: memory serial numbers and physical addresses
    // are intentionally not read or included in this local-only payload.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
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
"#;

    run_windows_powershell_json(SCRIPT, "CPU and memory inspection")
}

#[cfg(target_os = "windows")]
pub(super) fn collect_cpu_memory_live_stats() -> Result<serde_json::Value, String> {
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
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
"#;

    run_windows_powershell_json(SCRIPT, "CPU and memory live stats")
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_cpu_memory_info() -> Result<serde_json::Value, String> {
    Err("CPU and memory inspection is currently available on Windows only".to_string())
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_cpu_memory_live_stats() -> Result<serde_json::Value, String> {
    Err("CPU and memory inspection is currently available on Windows only".to_string())
}

#[derive(serde::Serialize)]
pub(super) struct DxgiAdapterInfo {
    description: String,
    vendor_id: u32,
    device_id: u32,
    dedicated_video_memory: u64,
    shared_system_memory: u64,
    flags: u32,
}

#[derive(serde::Serialize)]
pub(super) struct ActiveDisplayConfiguration {
    adapter_name: String,
    device_name: String,
    monitor_key: String,
    width: u32,
    height: u32,
    refresh_hz: u32,
}

#[tauri::command]
pub(super) async fn get_gpu_display_info() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_gpu_display_info)
        .await
        .map_err(|error| format!("GPU and display inspection worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
pub(super) fn collect_gpu_display_info() -> Result<serde_json::Value, String> {
    // WMI supplies display EDID and driver metadata. DXGI and GDI below are
    // intentionally used for data WMI cannot represent correctly, especially
    // dedicated memory on modern GPUs and per-display refresh rates.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
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
"#;

    let mut value = run_windows_powershell_json(SCRIPT, "GPU and display inspection")?;
    let object = value
        .as_object_mut()
        .ok_or("GPU and display inspection returned an invalid payload")?;
    object.insert(
        "dxgi_adapters".to_string(),
        serde_json::to_value(enumerate_dxgi_adapters()).map_err(|error| error.to_string())?,
    );
    object.insert(
        "display_configurations".to_string(),
        serde_json::to_value(enumerate_active_displays()).map_err(|error| error.to_string())?,
    );
    Ok(value)
}

#[cfg(target_os = "windows")]
pub(super) fn utf16z_to_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end]).trim().to_string()
}

#[cfg(target_os = "windows")]
pub(super) fn windows_display_match_key(value: &str) -> String {
    let uppercase = value.to_ascii_uppercase();
    for prefix in ["MONITOR\\", "DISPLAY\\", "MONITOR#", "DISPLAY#"] {
        if let Some(start) = uppercase.find(prefix) {
            let rest = &value[start + prefix.len()..];
            let end = rest
                .find(|character| character == '\\' || character == '#')
                .unwrap_or(rest.len());
            return rest[..end].trim().to_string();
        }
    }
    String::new()
}

#[cfg(target_os = "windows")]
pub(super) fn enumerate_dxgi_adapters() -> Vec<DxgiAdapterInfo> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_DESC1};

    let factory: IDXGIFactory1 = match unsafe { CreateDXGIFactory1() } {
        Ok(factory) => factory,
        Err(error) => {
            log::warn!("DXGI adapter enumeration is unavailable: {}", error);
            return Vec::new();
        }
    };
    let mut adapters = Vec::new();
    for index in 0..32_u32 {
        let adapter = match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => adapter,
            Err(_) => break,
        };
        let mut description = DXGI_ADAPTER_DESC1::default();
        if unsafe { adapter.GetDesc1(&mut description) }.is_err() {
            continue;
        }
        adapters.push(DxgiAdapterInfo {
            description: utf16z_to_string(&description.Description),
            vendor_id: description.VendorId,
            device_id: description.DeviceId,
            dedicated_video_memory: description.DedicatedVideoMemory as u64,
            shared_system_memory: description.SharedSystemMemory as u64,
            flags: description.Flags,
        });
    }
    adapters
}

#[cfg(target_os = "windows")]
pub(super) fn enumerate_active_displays() -> Vec<ActiveDisplayConfiguration> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplaySettingsW, DEVMODEW, DISPLAY_DEVICEW,
        DISPLAY_DEVICE_ATTACHED_TO_DESKTOP, ENUM_CURRENT_SETTINGS,
    };

    let mut displays = Vec::new();
    for index in 0..32_u32 {
        let mut adapter = DISPLAY_DEVICEW::default();
        adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        if !unsafe { EnumDisplayDevicesW(None, index, &mut adapter, 0) }.as_bool() {
            break;
        }
        if adapter.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP == 0 {
            continue;
        }
        let mut mode = DEVMODEW::default();
        mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
        if !unsafe {
            EnumDisplaySettingsW(
                PCWSTR(adapter.DeviceName.as_ptr()),
                ENUM_CURRENT_SETTINGS,
                &mut mode,
            )
        }
        .as_bool()
        {
            continue;
        }
        let mut monitor = DISPLAY_DEVICEW::default();
        monitor.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        let has_monitor =
            unsafe { EnumDisplayDevicesW(PCWSTR(adapter.DeviceName.as_ptr()), 0, &mut monitor, 0) }
                .as_bool();
        displays.push(ActiveDisplayConfiguration {
            adapter_name: utf16z_to_string(&adapter.DeviceString),
            device_name: utf16z_to_string(&adapter.DeviceName),
            monitor_key: if has_monitor {
                windows_display_match_key(&utf16z_to_string(&monitor.DeviceID))
            } else {
                String::new()
            },
            width: mode.dmPelsWidth,
            height: mode.dmPelsHeight,
            refresh_hz: mode.dmDisplayFrequency,
        });
    }
    displays
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_gpu_display_info() -> Result<serde_json::Value, String> {
    Err("GPU and display inspection is currently available on Windows only".to_string())
}

#[tauri::command]
pub(super) async fn get_mainboard_firmware_info() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_mainboard_firmware_info)
        .await
        .map_err(|error| format!("Mainboard and firmware inspection worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
pub(super) fn collect_mainboard_firmware_info() -> Result<serde_json::Value, String> {
    // This inventory intentionally leaves out board serial numbers, UUIDs,
    // PnP instance paths, and any other machine-identifying values. Windows
    // exposes PCI device names and status without needing those identifiers.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
function Epoch($value) {
  if ($null -eq $value) { return $null }
  try { return [long](($value).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalMilliseconds) } catch { return $null }
}
$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$enclosure = Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1
$secureBoot = 'unavailable'
try { if (Confirm-SecureBootUEFI) { $secureBoot = 'enabled' } else { $secureBoot = 'disabled' } } catch {}
$bootMode = if (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State') { 'uefi' } else { 'legacy_or_unavailable' }
$tpm = $null
try { $tpm = Get-Tpm } catch {}
$rawPci = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -like 'PCI\*' } | Sort-Object PNPClass, Name)
$pciDevices = @($rawPci | Group-Object { "$($_.PNPClass)`u001f$($_.Name)`u001f$($_.Manufacturer)`u001f$($_.Status)`u001f$($_.ConfigManagerErrorCode)" } | ForEach-Object {
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
"#;

    run_windows_powershell_json(SCRIPT, "Mainboard and firmware inspection")
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_mainboard_firmware_info() -> Result<serde_json::Value, String> {
    Err("Mainboard and firmware inspection is currently available on Windows only".to_string())
}

#[tauri::command]
pub(super) async fn get_storage_health_info() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_storage_health_info)
        .await
        .map_err(|error| format!("Storage and health inspection worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
pub(super) fn collect_storage_health_info() -> Result<serde_json::Value, String> {
    // Storage serials and volume labels are deliberately excluded. The page
    // needs only non-identifying capacity, health, and reliability data.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
function MaybeInt($value) {
  if ($null -eq $value) { return $null }
  return [Int64]$value
}
$physicalDisks = @()
try { $physicalDisks = @(Get-PhysicalDisk) } catch {}
$physicalById = @{}
foreach ($physical in $physicalDisks) { $physicalById[[string]$physical.DeviceId] = $physical }
$reliabilityById = @{}
if ($physicalDisks.Count -gt 0) {
  foreach ($physical in $physicalDisks) {
    try { @(Get-StorageReliabilityCounter -PhysicalDisk $physical) | ForEach-Object {
      $reliabilityById[[string]$_.DeviceId] = $_
    } } catch {}
  }
}
$disks = @()
try { $disks = @(Get-Disk | ForEach-Object {
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
}) } catch {}
$volumes = @()
try { $volumes = @(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | Sort-Object DriveLetter | ForEach-Object {
  [ordered]@{
    drive_letter = [string]$_.DriveLetter
    file_system = [string]$_.FileSystem
    size_bytes = [Int64]$_.Size
    free_bytes = [Int64]$_.SizeRemaining
    health_status = [string]$_.HealthStatus
  }
}) } catch {}
[ordered]@{ disks = $disks; volumes = $volumes } | ConvertTo-Json -Depth 6 -Compress
"#;

    run_windows_powershell_json(SCRIPT, "Storage and health inspection")
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_storage_health_info() -> Result<serde_json::Value, String> {
    Err("Storage and health inspection is currently available on Windows only".to_string())
}

#[tauri::command]
pub(super) async fn get_network_devices_info() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_network_devices_info)
        .await
        .map_err(|error| format!("Network and device inspection worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
pub(super) fn collect_network_devices_info() -> Result<serde_json::Value, String> {
    // Deliberately exclude addresses and identifiers: IP, MAC, Bluetooth
    // address, device instance path, and serial values do not help this page.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
function GroupDevices($items) {
  return @($items | Group-Object { "$($_.name)`u001f$($_.manufacturer)`u001f$($_.status)" } | ForEach-Object {
    $sample = $_.Group | Select-Object -First 1
    [ordered]@{
      name = [string]$sample.name
      manufacturer = [string]$sample.manufacturer
      status = [string]$sample.status
      count = [int]$_.Count
    }
  } | Select-Object -First 40)
}
$networkAdapters = @()
try { $networkAdapters = @(Get-NetAdapter -IncludeHidden | Where-Object { $_.Status -ne 'Not Present' } | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    description = [string]$_.InterfaceDescription
    status = [string]$_.Status
    link_speed = [string]$_.LinkSpeed
    physical = [bool]$_.HardwareInterface
  }
}) } catch {}
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
"#;

    run_windows_powershell_json(SCRIPT, "Network and device inspection")
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_network_devices_info() -> Result<serde_json::Value, String> {
    Err("Network and device inspection is currently available on Windows only".to_string())
}

#[tauri::command]
pub(super) async fn get_power_sensors_info() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(collect_power_sensors_info)
        .await
        .map_err(|error| format!("Power and sensor inspection worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
pub(super) fn collect_power_sensors_info() -> Result<serde_json::Value, String> {
    // Battery serial numbers, power-plan GUIDs, and sensor instance paths are
    // deliberately omitted. This page only needs human-readable read-only data.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
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
  return [double]("{0:F1}" -f (([double]$value / 10.0) - 273.15))
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
  $health = if ($designCapacity -and $designCapacity -gt 0 -and $fullCapacity -and $fullCapacity -gt 0) { [int](($fullCapacity / $designCapacity) * 100 + 0.5) } else { $null }
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
"#;

    run_windows_powershell_json(SCRIPT, "Power and sensor inspection")
}

#[cfg(not(target_os = "windows"))]
pub(super) fn collect_power_sensors_info() -> Result<serde_json::Value, String> {
    Err("Power and sensor inspection is currently available on Windows only".to_string())
}

#[tauri::command]
pub(super) async fn scan_large_files(
    root_path: String,
    min_size_mb: Option<u64>,
    mode: Option<String>,
    allow_system_drive_root: Option<bool>,
    scan_id: String,
) -> Result<LargeFileScanResult, String> {
    let session = cleanup_guard::begin(&scan_id)?;
    tokio::task::spawn_blocking(move || {
        let result = collect_large_files_with_session(
            root_path,
            min_size_mb,
            mode,
            allow_system_drive_root.unwrap_or(false),
            Some(&session),
        );
        match result {
            Ok(mut result) => {
                session.check()?;
                session.finish();
                result.scan_id = scan_id;
                Ok(result)
            }
            Err(error) => {
                cleanup_guard::cancel(&scan_id);
                Err(error)
            }
        }
    })
    .await
    .map_err(|error| format!("Large file scan worker failed: {}", error))?
}

#[tauri::command]
pub(super) fn cancel_large_file_scan(scan_id: String) {
    cleanup_guard::cancel(&scan_id);
}

#[cfg(test)]
pub(super) fn collect_large_files(
    root_path: String,
    min_size_mb: Option<u64>,
    mode: Option<String>,
    allow_system_drive_root: bool,
) -> Result<LargeFileScanResult, String> {
    collect_large_files_with_session(root_path, min_size_mb, mode, allow_system_drive_root, None)
}

fn collect_large_files_with_session(
    root_path: String,
    min_size_mb: Option<u64>,
    mode: Option<String>,
    allow_system_drive_root: bool,
    session: Option<&cleanup_guard::ScanSession>,
) -> Result<LargeFileScanResult, String> {
    let started = std::time::Instant::now();
    let root = canonical_scan_root(&root_path, allow_system_drive_root)?;
    if let Some(session) = session {
        session.check()?;
        session.set_root(&root);
    }
    let min_size_mb = min_size_mb.unwrap_or(50).clamp(10, 102_400);
    let min_size_bytes = min_size_mb.saturating_mul(1024 * 1024);
    let mode = normalize_large_file_mode(mode.as_deref());
    let mut scanned_files = 0_u64;
    let mut skipped_dirs = 0_u64;
    let mut protected_dirs = 0_u64;
    let mut protected_files = 0_u64;
    let mut denied_dirs = 0_u64;
    let mut candidates = Vec::new();
    let mut stack = vec![root.clone()];
    const MAX_SCAN_FILES: u64 = 250_000;
    const MAX_RESULTS: usize = 1200;

    while let Some(directory) = stack.pop() {
        if let Some(session) = session {
            session.check()?;
        }
        if cleanup_guard::reject_links(&directory).is_err() {
            protected_dirs += 1;
            skipped_dirs += 1;
            continue;
        }
        if should_skip_cleanup_dir(&directory, &root, &mut protected_dirs) {
            skipped_dirs += 1;
            continue;
        }
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                skipped_dirs += 1;
                denied_dirs += 1;
                continue;
            }
        };
        for entry in entries.flatten() {
            if let Some(session) = session {
                session.check()?;
            }
            if scanned_files >= MAX_SCAN_FILES {
                break;
            }
            let path = entry.path();
            if cleanup_path_is_reparse_point(&path) {
                if entry
                    .file_type()
                    .map(|file_type| file_type.is_dir())
                    .unwrap_or(false)
                {
                    protected_dirs += 1;
                } else {
                    protected_files += 1;
                }
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => {
                    if entry
                        .file_type()
                        .map(|file_type| file_type.is_dir())
                        .unwrap_or(false)
                    {
                        denied_dirs += 1;
                    }
                    continue;
                }
            };
            if metadata.is_dir() {
                if cleanup_guard::protected_attributes(&metadata, true) {
                    protected_dirs += 1;
                    skipped_dirs += 1;
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            scanned_files += 1;
            if is_protected_cleanup_file(&path, &metadata) {
                protected_files += 1;
                continue;
            }
            let size_bytes = metadata.len();
            if size_bytes < min_size_bytes {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let category = cleanup_file_category(&extension);
            if category == "other" || !cleanup_mode_allows(&mode, category) {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .and_then(|duration| i64::try_from(duration.as_millis()).ok());
            let (risk, local_reason) = cleanup_local_risk(&path, category, size_bytes);
            let identity = match cleanup_guard::file_identity(&path) {
                Ok(identity) => identity,
                Err(_) => {
                    protected_files += 1;
                    continue;
                }
            };
            if let Some(session) = session {
                session.record(&path, &metadata, identity);
            }
            candidates.push(LargeFileCandidate {
                id: format!("lf-{}", candidates.len() + 1),
                path: cleanup_display_path(&path),
                name,
                extension,
                category: category.to_string(),
                size_bytes,
                modified_at,
                folder_hint: cleanup_folder_hint(&path, &root),
                risk,
                local_reason,
            });
            if candidates.len() >= MAX_RESULTS {
                break;
            }
        }
        if scanned_files >= MAX_SCAN_FILES || candidates.len() >= MAX_RESULTS {
            break;
        }
    }

    candidates.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.name.cmp(&b.name))
    });
    let drive_space = cleanup_drive_space_from_path(&cleanup_display_path(&root))
        .ok()
        .flatten();
    Ok(LargeFileScanResult {
        scan_id: String::new(),
        policy_version: cleanup_guard::POLICY_VERSION.to_string(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        truncated: scanned_files >= MAX_SCAN_FILES || candidates.len() >= MAX_RESULTS,
        root_path: cleanup_display_path(&root),
        min_size_bytes,
        mode,
        scanned_files,
        skipped_dirs,
        protected_dirs,
        protected_files,
        denied_dirs,
        drive_space,
        candidates,
    })
}

#[tauri::command]
pub(super) fn get_cleanup_drive_space(
    root_path: String,
) -> Result<Option<CleanupDriveSpace>, String> {
    cleanup_drive_space_from_path(&root_path)
}

#[cfg(target_os = "windows")]
pub(super) fn cleanup_drive_space_from_path(
    root_path: &str,
) -> Result<Option<CleanupDriveSpace>, String> {
    use std::os::windows::process::CommandExt;

    if root_path.contains('\0') {
        return Err("Invalid drive path".to_string());
    }
    let Some(drive) = cleanup_drive_root_letter_from_input(root_path) else {
        return Ok(None);
    };
    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='{}:'" | Select-Object -First 1
if ($null -ne $disk) {{
  [ordered]@{{ drive = '{}:\'; free_bytes = [Int64]$disk.FreeSpace; total_bytes = [Int64]$disk.Size }} | ConvertTo-Json -Compress
}}
"#,
        drive, drive
    );
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| format!("Cannot read drive space: {}", error))?;
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr)
            .trim()
            .replace(['\r', '\n'], " ");
        return Err(if details.is_empty() {
            "Cannot read drive space".to_string()
        } else {
            format!(
                "Cannot read drive space: {}",
                details.chars().take(240).collect::<String>()
            )
        });
    }
    let payload = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if payload.is_empty() {
        return Ok(None);
    }
    serde_json::from_str::<CleanupDriveSpace>(&payload)
        .map(Some)
        .map_err(|error| format!("Drive space returned invalid data: {}", error))
}

#[cfg(not(target_os = "windows"))]
pub(super) fn cleanup_drive_space_from_path(
    _root_path: &str,
) -> Result<Option<CleanupDriveSpace>, String> {
    Ok(None)
}

#[cfg(target_os = "windows")]
pub(super) fn cleanup_drive_root_letter_from_input(root_path: &str) -> Option<char> {
    let trimmed = root_path.trim();
    let without_verbatim = trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed);
    let bytes = without_verbatim.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        let rest = &without_verbatim[2..];
        if rest.is_empty() || rest.chars().all(|ch| ch == '\\' || ch == '/') {
            return Some((bytes[0] as char).to_ascii_uppercase());
        }
    }
    cleanup_drive_root_letter(std::path::Path::new(root_path))
}

pub(super) fn canonical_scan_root(
    root_path: &str,
    allow_system_drive_root: bool,
) -> Result<std::path::PathBuf, String> {
    if root_path.contains('\0') {
        return Err("Invalid scan folder".to_string());
    }
    cleanup_guard::reject_links(std::path::Path::new(root_path))?;
    let root = std::path::PathBuf::from(root_path)
        .canonicalize()
        .map_err(|error| format!("Cannot access scan folder: {}", error))?;
    if !root.is_dir() {
        return Err("Scan target must be a folder".to_string());
    }
    if is_broad_or_protected_cleanup_root(&root)
        && !(allow_system_drive_root && cleanup_guard::system_drive_root(&root))
    {
        return Err("System drive root is blocked. Please choose a user folder such as Downloads, Desktop, Videos, or a project export folder.".to_string());
    }
    Ok(root)
}

#[cfg(target_os = "windows")]
pub(super) fn canonical_fixed_drive_root(root_path: &str) -> Result<std::path::PathBuf, String> {
    if root_path.contains('\0') {
        return Err("Invalid scan folder".to_string());
    }
    cleanup_guard::reject_links(std::path::Path::new(root_path))?;
    let root = std::path::PathBuf::from(root_path)
        .canonicalize()
        .map_err(|error| format!("Cannot access scan drive: {}", error))?;
    if !root.is_dir() || cleanup_drive_root_letter(&root).is_none() {
        return Err("Scan target must be a drive root".to_string());
    }
    Ok(root)
}

pub(super) fn normalize_large_file_mode(mode: Option<&str>) -> String {
    match mode.unwrap_or("video").to_ascii_lowercase().as_str() {
        "all" | "video" | "archives" | "installers" | "documents" | "images" | "audio"
        | "models" => mode.unwrap_or("video").to_ascii_lowercase(),
        _ => "video".to_string(),
    }
}

pub(super) fn cleanup_file_category(extension: &str) -> &'static str {
    match extension {
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "flv" | "m4v" | "wmv" | "ts" | "mpeg" | "mpg" => {
            "video"
        }
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" => "archives",
        "exe" | "msi" | "msix" | "appx" => "installers",
        "pdf" | "ppt" | "pptx" | "doc" | "docx" | "xls" | "xlsx" | "csv" => "documents",
        "psd" | "ai" | "fig" | "raw" | "arw" | "cr2" | "nef" | "tif" | "tiff" | "png" | "jpg"
        | "jpeg" | "webp" | "bmp" => "images",
        "wav" | "flac" | "mp3" | "aac" | "m4a" | "ogg" | "wma" | "alac" => "audio",
        "gguf" | "safetensors" | "pth" | "pt" | "onnx" | "bin" | "ckpt" | "model" => "models",
        _ => "other",
    }
}

pub(super) fn cleanup_mode_allows(mode: &str, category: &str) -> bool {
    mode == "all" || mode == category
}

pub(super) fn is_broad_or_protected_cleanup_root(path: &std::path::Path) -> bool {
    let text = path.to_string_lossy().to_ascii_lowercase();
    #[cfg(target_os = "windows")]
    {
        if let Some(drive) = cleanup_drive_root_letter(path) {
            let _ = drive;
            return cleanup_guard::system_drive_root(path);
        }
    }
    let mut normal_components = 0_usize;
    let mut has_root_or_prefix = false;
    for component in path.components() {
        match component {
            std::path::Component::Normal(_) => normal_components += 1,
            std::path::Component::Prefix(_) | std::path::Component::RootDir => {
                has_root_or_prefix = true
            }
            _ => {}
        }
    }
    if (has_root_or_prefix && normal_components == 0) || text == r"\" || text == "/" {
        return true;
    }
    cleanup_guard::protected_path(path)
}

#[cfg(target_os = "windows")]
pub(super) fn cleanup_drive_root_letter(path: &std::path::Path) -> Option<char> {
    let mut components = path.components();
    let drive = match components.next() {
        Some(std::path::Component::Prefix(prefix)) => match prefix.kind() {
            std::path::Prefix::Disk(letter) | std::path::Prefix::VerbatimDisk(letter) => {
                Some((letter as char).to_ascii_uppercase())
            }
            _ => None,
        },
        _ => None,
    }?;
    if !matches!(components.next(), Some(std::path::Component::RootDir)) {
        return None;
    }
    if components.next().is_some() {
        return None;
    }
    Some(drive)
}

pub(super) fn cleanup_display_path(path: &std::path::Path) -> String {
    let text = path.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    {
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{}", rest);
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    text
}

pub(super) fn protected_cleanup_dir_names(path: &std::path::Path) -> Vec<String> {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => {
                Some(value.to_string_lossy().to_ascii_lowercase())
            }
            _ => None,
        })
        .collect()
}

pub(super) fn should_skip_cleanup_dir(
    path: &std::path::Path,
    root: &std::path::Path,
    protected_dirs: &mut u64,
) -> bool {
    if path != root && is_broad_or_protected_cleanup_root(path) {
        *protected_dirs = protected_dirs.saturating_add(1);
        return true;
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let protected_by_name = matches!(
        name.as_str(),
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".cache"
            | "cache"
            | "tmp"
            | "temp"
            | "appdata"
            | "recovery"
            | "boot"
            | "efi"
            | "config.msi"
            | "system32"
            | "syswow64"
            | "winsxs"
            | "systemapps"
            | "apprepository"
    );
    if protected_by_name {
        *protected_dirs = protected_dirs.saturating_add(1);
    }
    protected_by_name
}

pub(super) fn cleanup_path_is_reparse_point(path: &std::path::Path) -> bool {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return true,
    };
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub(super) fn is_protected_cleanup_file(
    path: &std::path::Path,
    metadata: &std::fs::Metadata,
) -> bool {
    if cleanup_path_is_reparse_point(path) || metadata.permissions().readonly() {
        return true;
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "sys" | "dll" | "ocx" | "efi" | "cat" | "cpl" | "drv" | "mui" | "msu" | "cab"
    ) {
        return true;
    }
    if matches!(
        name.as_str(),
        "pagefile.sys"
            | "hiberfil.sys"
            | "swapfile.sys"
            | "memory.dmp"
            | "bootmgr"
            | "bootnxt"
            | "bootsect.bak"
            | "dumpstack.log.tmp"
            | "dumpstack.log"
    ) {
        return true;
    }
    cleanup_guard::protected_attributes(metadata, false)
}

pub(super) fn cleanup_folder_hint(path: &std::path::Path, root: &std::path::Path) -> String {
    let parent = path.parent().unwrap_or(root);
    let relative = parent
        .strip_prefix(root)
        .unwrap_or(std::path::Path::new(""));
    let hint = relative.to_string_lossy().trim().to_string();
    if hint.is_empty() || hint == "." {
        "selected folder".to_string()
    } else {
        // Avoid sending the user account name during a drive-root scan.
        let mut parts: Vec<String> = relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect();
        if parts
            .first()
            .is_some_and(|part| part.eq_ignore_ascii_case("users"))
            && parts.len() > 1
        {
            parts[1] = "[user]".into();
        }
        parts.join("/")
    }
}

pub(super) fn cleanup_local_risk(
    path: &std::path::Path,
    category: &str,
    size_bytes: u64,
) -> (String, String) {
    let text = path.to_string_lossy().to_ascii_lowercase();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if text.contains("\\wechat") || text.contains("\\xwechat") || text.contains("\\wxid_") {
        return (
            "high".to_string(),
            "聊天文件目录，默认不建议自动删除".to_string(),
        );
    }
    if text.contains("\\projects\\")
        || text.contains("\\source\\")
        || text.contains("\\repo")
        || text.contains("\\src\\")
    {
        return (
            "high".to_string(),
            "疑似项目或源码目录，需要人工确认".to_string(),
        );
    }
    if matches!(category, "models") {
        return (
            "high".to_string(),
            "模型或开发资源通常可重新下载但体积大，删除前需要确认".to_string(),
        );
    }
    if matches!(category, "installers" | "archives")
        && (text.contains("\\download") || text.contains("\\downloads") || text.contains("\\下载"))
    {
        return (
            "low".to_string(),
            "下载目录中的安装包或压缩包，通常适合清理".to_string(),
        );
    }
    if category == "video"
        && (file_name.contains("录屏")
            || file_name.contains("record")
            || file_name.contains("capture")
            || file_name.contains("temp"))
    {
        return ("low".to_string(), "疑似录屏、导出或临时视频".to_string());
    }
    if size_bytes >= 1024 * 1024 * 1024 {
        return (
            "medium".to_string(),
            "体积超过 1GB，建议优先人工确认用途".to_string(),
        );
    }
    (
        "medium".to_string(),
        "大文件候选项，需要结合用途确认".to_string(),
    )
}

pub(super) fn canonical_cleanup_scope(
    scan_root: Option<&str>,
) -> Result<Option<std::path::PathBuf>, String> {
    let scan_root = scan_root
        .filter(|value| !value.trim().is_empty())
        .ok_or("A scan scope is required")?;
    if scan_root.contains('\0') {
        return Err("Invalid scan scope".to_string());
    }
    let root = std::path::PathBuf::from(scan_root)
        .canonicalize()
        .map_err(|error| format!("Cannot access scan scope: {}", error))?;
    if !root.is_dir() {
        return Err("Scan scope must be a folder".to_string());
    }
    Ok(Some(root))
}

pub(super) fn validate_cleanup_delete_path(
    path: &str,
    scan_scope: Option<&std::path::Path>,
) -> Result<(std::path::PathBuf, u64), String> {
    if path.contains('\0') {
        return Err("Invalid file path".to_string());
    }
    let input = std::path::Path::new(path);
    cleanup_guard::reject_links(input)?;
    if cleanup_path_is_reparse_point(input) {
        return Err("Links and reparse points are not allowed".to_string());
    }
    let canonical = input
        .canonicalize()
        .map_err(|error| format!("Cannot access file: {}", error))?;
    if let Some(scope) = scan_scope {
        if !canonical.starts_with(scope) {
            return Err("File is outside the current scan scope".to_string());
        }
    }
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("Cannot access file metadata: {}", error))?;
    if !metadata.is_file() {
        return Err("Target is not a regular file".to_string());
    }
    if is_broad_or_protected_cleanup_root(&canonical)
        || is_protected_cleanup_file(&canonical, &metadata)
    {
        return Err("Protected file path is not allowed".to_string());
    }
    Ok((canonical, metadata.len()))
}

#[tauri::command]
pub(super) async fn move_files_to_recycle_bin(
    paths: Vec<String>,
    scan_root: Option<String>,
    scan_id: String,
) -> Result<RecycleBinMoveResult, String> {
    let session = cleanup_guard::get(&scan_id)?;
    tokio::task::spawn_blocking(move || {
        move_files_to_recycle_bin_checked(paths, scan_root, Some(&session))
    })
    .await
    .map_err(|error| format!("Recycle bin worker failed: {}", error))?
}

#[cfg(target_os = "windows")]
#[cfg(test)]
pub(super) fn move_files_to_recycle_bin_blocking(
    paths: Vec<String>,
    scan_root: Option<String>,
) -> Result<RecycleBinMoveResult, String> {
    move_files_to_recycle_bin_checked(paths, scan_root, None)
}

#[cfg(target_os = "windows")]
fn move_files_to_recycle_bin_checked(
    paths: Vec<String>,
    scan_root: Option<String>,
    session: Option<&cleanup_guard::ScanSession>,
) -> Result<RecycleBinMoveResult, String> {
    if paths.len() > 200 {
        return Err("Select at most 200 files per operation".into());
    }
    let scan_scope = canonical_cleanup_scope(scan_root.as_deref())?;
    let mut items = Vec::new();
    let mut moved = 0_usize;
    let mut failed = 0_usize;
    let mut freed_bytes = 0_u64;

    for path in paths.into_iter().take(200) {
        let original_path = path.clone();
        let validated =
            validate_cleanup_delete_path(&path, scan_scope.as_deref()).and_then(|value| {
                match session {
                    Some(session) => session.validate(&path),
                    None => Ok(value),
                }
            });
        let canonical = match validated {
            Ok((canonical, _)) => canonical,
            Err(error) => {
                failed += 1;
                items.push(RecycleBinMoveItem {
                    path: original_path,
                    ok: false,
                    error: Some(error),
                });
                continue;
            }
        };
        let display_path = cleanup_display_path(&canonical);
        let size = std::fs::metadata(&canonical)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        match move_single_file_to_recycle_bin(&canonical) {
            Ok(()) if !canonical.exists() => {
                moved += 1;
                freed_bytes = freed_bytes.saturating_add(size);
                items.push(RecycleBinMoveItem {
                    path: display_path,
                    ok: true,
                    error: None,
                });
            }
            Ok(()) => {
                failed += 1;
                items.push(RecycleBinMoveItem {
                    path: display_path,
                    ok: false,
                    error: Some("Windows reported success, but the file still exists. It may be in use or blocked by permissions.".to_string()),
                });
            }
            Err(error) => {
                failed += 1;
                items.push(RecycleBinMoveItem {
                    path: display_path,
                    ok: false,
                    error: Some(error),
                });
            }
        }
    }

    Ok(RecycleBinMoveResult {
        requested: items.len(),
        moved,
        failed,
        freed_bytes,
        items,
    })
}

#[cfg(target_os = "windows")]
pub(super) fn move_single_file_to_recycle_bin(path: &std::path::Path) -> Result<(), String> {
    RecycleBinBatch::new()?
        .move_batch(&[path.to_path_buf()], &|_| Ok(()))
        .into_iter()
        .next()
        .unwrap_or_else(|| Err("No recycle result".into()))
}

// One apartment per cleanup worker; bounded batches avoid thousands of Shell initializations.
#[cfg(target_os = "windows")]
pub(super) struct RecycleBinBatch {
    _thread_bound: std::marker::PhantomData<std::rc::Rc<()>>,
}

#[cfg(target_os = "windows")]
impl RecycleBinBatch {
    pub(super) fn new() -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }
            .map_err(|error| format!("Cannot initialize Recycle Bin API: {}", error.code()))?;
        Ok(Self {
            _thread_bound: std::marker::PhantomData,
        })
    }

    pub(super) fn move_batch(
        &self,
        paths: &[std::path::PathBuf],
        validate: &dyn Fn(&std::path::Path) -> Result<(), String>,
    ) -> Vec<Result<(), String>> {
        let results = self.run(paths, validate);
        if paths.len() == 1 {
            return results;
        }
        paths
            .iter()
            .zip(results)
            .map(|(path, outcome)| {
                // Retry only an existing, still-valid file. Never retry an ambiguous/missing path.
                if outcome.is_err()
                    && std::fs::symlink_metadata(path).is_ok()
                    && validate(path).is_ok()
                {
                    self.run(std::slice::from_ref(path), validate).remove(0)
                } else {
                    outcome
                }
            })
            .collect()
    }

    fn run(
        &self,
        paths: &[std::path::PathBuf],
        validate: &dyn Fn(&std::path::Path) -> Result<(), String>,
    ) -> Vec<Result<(), String>> {
        use windows::core::HSTRING;
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
        use windows::Win32::UI::Shell::{
            FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
            FOFX_ADDUNDORECORD, FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_NOERRORUI, FOF_SILENT,
        };
        let mut results = vec![Err("File was not queued".into()); paths.len()];
        let mut queued = Vec::new();
        let run = || -> windows::core::Result<()> {
            let operation: IFileOperation =
                unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)? };
            // Explicit recycling only; no permanent-delete fallback.
            unsafe {
                operation.SetOperationFlags(
                    FOFX_RECYCLEONDELETE
                        | FOFX_EARLYFAILURE
                        | FOFX_ADDUNDORECORD
                        | FOF_NOERRORUI
                        | FOF_SILENT,
                )?;
            }
            for (index, path) in paths.iter().enumerate() {
                results[index] = validate(path).and_then(|_| {
                    let item: IShellItem = unsafe {
                        SHCreateItemFromParsingName(
                            &HSTRING::from(cleanup_display_path(path)),
                            None,
                        )
                    }
                    .map_err(|error| format!("Cannot queue file: {}", error.code()))?;
                    unsafe { operation.DeleteItem(&item, None) }
                        .map_err(|error| format!("Cannot queue file: {}", error.code()))?;
                    queued.push(index);
                    Ok(())
                });
            }
            if !queued.is_empty() {
                unsafe {
                    operation.PerformOperations()?;
                }
            }
            Ok(())
        };
        let mut run = run;
        let operation_error = run()
            .err()
            .map(|error| format!("Windows Recycle Bin API failed: {}", error.code()));
        for index in queued {
            results[index] = match std::fs::symlink_metadata(&paths[index]) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                _ => Err(operation_error
                    .clone()
                    .unwrap_or_else(|| "Windows did not move the file to the Recycle Bin".into())),
            };
        }
        if let Some(error) = operation_error {
            for result in &mut results {
                if matches!(result, Err(message) if message == "File was not queued") {
                    *result = Err(error.clone());
                }
            }
        }
        results
    }
}

#[cfg(target_os = "windows")]
impl Drop for RecycleBinBatch {
    fn drop(&mut self) {
        unsafe {
            windows::Win32::System::Com::CoUninitialize();
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn move_files_to_recycle_bin_checked(
    _paths: Vec<String>,
    _scan_root: Option<String>,
    _session: Option<&cleanup_guard::ScanSession>,
) -> Result<RecycleBinMoveResult, String> {
    Err("Recycle bin cleanup is currently available on Windows only".to_string())
}

#[cfg(test)]
mod cleanup_large_file_tests {
    use super::*;
    use std::io::Write;

    const MB: u64 = 1024 * 1024;

    fn cleanup_test_dir(label: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tmp/cleanup-native-tests")
            .join(format!(
                "toolknit-cleanup-{}-{}-{}",
                label,
                std::process::id(),
                nanos
            ));
        std::fs::create_dir_all(&dir).expect("create cleanup test dir");
        dir
    }

    fn make_sparse_file(path: &std::path::Path, size: u64) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create file parent");
        }
        let mut file = std::fs::File::create(path).expect("create sparse file");
        file.write_all(b"toolknit").expect("seed sparse file");
        file.set_len(size).expect("resize sparse file");
    }

    #[test]
    fn cleanup_scan_filters_mode_and_skips_dependency_dirs() {
        let dir = cleanup_test_dir("mode-skip");
        make_sparse_file(&dir.join("screen-record.mp4"), 11 * MB);
        make_sparse_file(&dir.join("installer.zip"), 12 * MB);
        make_sparse_file(&dir.join("node_modules").join("cached-video.mp4"), 12 * MB);

        let result = collect_large_files(
            dir.to_string_lossy().into_owned(),
            Some(10),
            Some("video".to_string()),
            false,
        )
        .expect("scan video mode");

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].name, "screen-record.mp4");
        assert_eq!(result.candidates[0].category, "video");
        assert!(result.skipped_dirs >= 1);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_scan_all_keeps_supported_large_files_only() {
        let dir = cleanup_test_dir("all-supported");
        make_sparse_file(&dir.join("backup.iso"), 11 * MB);
        make_sparse_file(&dir.join("notes.tmp"), 12 * MB);
        make_sparse_file(&dir.join("report.pdf"), 13 * MB);

        let result = collect_large_files(
            dir.to_string_lossy().into_owned(),
            Some(10),
            Some("all".to_string()),
            false,
        )
        .expect("scan all mode");
        let names: Vec<_> = result
            .candidates
            .iter()
            .map(|item| item.name.as_str())
            .collect();

        assert!(names.contains(&"backup.iso"));
        assert!(names.contains(&"report.pdf"));
        assert!(!names.contains(&"notes.tmp"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_scan_requires_explicit_system_drive_authorization() {
        #[cfg(target_os = "windows")]
        {
            assert!(is_broad_or_protected_cleanup_root(std::path::Path::new(
                "C:\\"
            )));
            assert!(!is_broad_or_protected_cleanup_root(std::path::Path::new(
                "D:\\"
            )));
            let error = match collect_large_files(
                "C:\\".to_string(),
                Some(10),
                Some("all".to_string()),
                false,
            ) {
                Ok(_) => panic!("system drive root should be rejected"),
                Err(error) => error,
            };
            assert!(error.contains("System drive root is blocked"));
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cleanup_recycle_bin_moves_temp_file() {
        let dir = cleanup_test_dir("recycle");
        let file_path = dir.join("delete-me.tmp");
        make_sparse_file(&file_path, 1024);

        let result = move_files_to_recycle_bin_blocking(
            vec![file_path.to_string_lossy().into_owned()],
            Some(dir.to_string_lossy().into_owned()),
        )
        .expect("move temp file to recycle bin");

        assert_eq!(result.requested, 1);
        assert_eq!(result.moved, 1);
        assert_eq!(result.failed, 0);
        assert!(!file_path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_policy_scans_only_unprotected_files_and_enforces_session() {
        let dir = cleanup_test_dir("policy");
        make_sparse_file(&dir.join("Windows").join("system.mp4"), 11 * MB);
        make_sparse_file(&dir.join("AppData").join("database.zip"), 11 * MB);
        make_sparse_file(&dir.join("Recovery").join("restore.iso"), 11 * MB);
        make_sparse_file(&dir.join("module.dll"), 11 * MB);
        let allowed = dir.join("WindowsBackup").join("record.mp4");
        make_sparse_file(&allowed, 11 * MB);
        let id = format!(
            "cleanup-policy-{}",
            dir.file_name().unwrap().to_string_lossy()
        );
        let id = id.chars().take(80).collect::<String>();
        let session = cleanup_guard::begin(&id).unwrap();
        let result = collect_large_files_with_session(
            dir.to_string_lossy().into_owned(),
            Some(10),
            Some("all".into()),
            false,
            Some(&session),
        )
        .unwrap();
        session.finish();
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].name, "record.mp4");
        assert!(result.protected_dirs >= 3);
        assert!(result.protected_files >= 1);
        assert!(session.validate(&allowed.to_string_lossy()).is_ok());
        assert!(validate_cleanup_delete_path(
            &dir.join("AppData/database.zip").to_string_lossy(),
            Some(&dir.canonicalize().unwrap())
        )
        .is_err());
        let unscanned = dir.join("unscanned.mp4");
        make_sparse_file(&unscanned, 11 * MB);
        assert!(session.validate(&unscanned.to_string_lossy()).is_err());
        make_sparse_file(&allowed, 12 * MB);
        assert!(
            session.validate(&allowed.to_string_lossy()).is_err(),
            "changed file must be rejected"
        );
        cleanup_guard::cancel(&id);
        assert!(session.check().is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_policy_rejects_readonly_and_outside_scope() {
        let dir = cleanup_test_dir("scope");
        let nested = dir.join("scope");
        std::fs::create_dir_all(&nested).unwrap();
        let file = dir.join("outside.mp4");
        make_sparse_file(&file, 11 * MB);
        assert!(validate_cleanup_delete_path(
            &file.to_string_lossy(),
            Some(&nested.canonicalize().unwrap())
        )
        .is_err());
        assert!(canonical_cleanup_scope(None).is_err());
        let original = std::fs::metadata(&file).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        std::fs::set_permissions(&file, readonly).unwrap();
        assert!(validate_cleanup_delete_path(
            &file.to_string_lossy(),
            Some(&dir.canonicalize().unwrap())
        )
        .is_err());
        std::fs::set_permissions(&file, original).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cleanup_session_recycle_rechecks_each_file() {
        let dir = cleanup_test_dir("session-recycle");
        let stable = dir.join("stable.mp4");
        let changed = dir.join("changed.mp4");
        make_sparse_file(&stable, 11 * MB);
        make_sparse_file(&changed, 11 * MB);
        let id = format!(
            "session-recycle-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let session = cleanup_guard::begin(&id).unwrap();
        collect_large_files_with_session(
            dir.to_string_lossy().into_owned(),
            Some(10),
            Some("all".into()),
            false,
            Some(&session),
        )
        .unwrap();
        session.finish();
        make_sparse_file(&changed, 12 * MB);
        let result = move_files_to_recycle_bin_checked(
            vec![
                stable.to_string_lossy().into_owned(),
                changed.to_string_lossy().into_owned(),
            ],
            Some(dir.to_string_lossy().into_owned()),
            Some(&session),
        )
        .unwrap();
        assert_eq!(result.moved, 1);
        assert_eq!(result.failed, 1);
        assert!(!stable.exists());
        assert!(
            changed.exists(),
            "changed file must survive the cleanup request"
        );
        cleanup_guard::cancel(&id);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_cancel_before_start_and_repeated_scans() {
        let prefix = format!(
            "cleanup-cancel-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        cleanup_guard::cancel(&prefix);
        assert!(cleanup_guard::begin(&prefix).is_err());
        for index in 0..40 {
            let id = format!("{prefix}-{index}");
            let session = cleanup_guard::begin(&id).unwrap();
            cleanup_guard::cancel(&id);
            assert!(session.check().is_err());
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cleanup_policy_excludes_hardlinks_hidden_files_and_junctions() {
        use std::os::windows::process::CommandExt;
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::{
            SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL,
        };
        // Resolve the parent before invoking cmd.exe: an unquoted `..` segment
        // can be parsed as a switch by mklink on runners whose path has no spaces.
        let dir = std::fs::canonicalize(cleanup_test_dir("links"))
            .expect("canonicalize cleanup test dir");
        let original = dir.join("original.mp4");
        make_sparse_file(&original, 11 * MB);
        std::fs::hard_link(&original, dir.join("alias.mp4")).unwrap();
        assert!(cleanup_guard::file_identity(&original).is_err());
        let hidden = dir.join("hidden.mp4");
        make_sparse_file(&hidden, 11 * MB);
        unsafe {
            SetFileAttributesW(
                &HSTRING::from(hidden.to_string_lossy().as_ref()),
                FILE_ATTRIBUTE_HIDDEN,
            )
            .unwrap();
        }
        let target = dir.join("source");
        std::fs::create_dir_all(&target).unwrap();
        make_sparse_file(&target.join("visible.mp4"), 11 * MB);
        let junction = dir.join("redirect");
        let status = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "fixture junction creation failed: {} {}",
            String::from_utf8_lossy(&status.stdout),
            String::from_utf8_lossy(&status.stderr)
        );
        assert!(canonical_scan_root(&junction.to_string_lossy(), false).is_err());
        assert!(cleanup_guard::reject_links(&junction.join("visible.mp4")).is_err());
        let result = collect_large_files(
            dir.to_string_lossy().into_owned(),
            Some(10),
            Some("all".into()),
            false,
        )
        .unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].name, "visible.mp4");
        unsafe {
            SetFileAttributesW(
                &HSTRING::from(hidden.to_string_lossy().as_ref()),
                FILE_ATTRIBUTE_NORMAL,
            )
            .unwrap();
        }
        std::fs::remove_dir(&junction).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cleanup_policy_system_root_authorization_does_not_open_system_folders() {
        assert!(canonical_scan_root("C:\\", false).is_err());
        assert!(canonical_scan_root("C:\\", true).is_ok());
        assert!(canonical_scan_root("C:\\Windows", true).is_err());
        for path in [
            "c:\\WINDOWS\\a.mp4",
            "C:\\Users\\sample\\AppData\\a.zip",
            "C:\\ProgramData\\a.zip",
            "C:\\Recovery\\a.iso",
            "C:\\EFI\\boot.zip",
        ] {
            assert!(cleanup_guard::protected_path(std::path::Path::new(path)));
        }
        assert!(!cleanup_guard::protected_path(std::path::Path::new(
            "C:\\WindowsBackup\\a.mp4"
        )));
        let hint = cleanup_folder_hint(
            std::path::Path::new("C:\\Users\\private-name\\Downloads\\video.mp4"),
            std::path::Path::new("C:\\"),
        );
        assert_eq!(hint, "Users/[user]/Downloads");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cleanup_recycle_bin_moves_unicode_video_file() {
        let dir = cleanup_test_dir("recycle-unicode");
        let file_path = dir.join("error [レッドゾーン] (1080p_60fps_H264-128kbit_AAC).mp4");
        make_sparse_file(&file_path, 1024);

        let result = move_files_to_recycle_bin_blocking(
            vec![file_path.to_string_lossy().into_owned()],
            Some(dir.to_string_lossy().into_owned()),
        )
        .expect("move unicode video file to recycle bin");

        assert_eq!(result.requested, 1);
        assert_eq!(
            result.moved,
            1,
            "items: {}",
            serde_json::to_string(&result.items).unwrap()
        );
        assert_eq!(result.failed, 0);
        assert!(!file_path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
