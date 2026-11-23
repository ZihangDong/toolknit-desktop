param(
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [string]$Python = 'python',
    [string]$DesktopExecutable,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $DesktopExecutable) {
    $DesktopExecutable = Join-Path $projectRoot 'src-tauri\target\release\toolknit-desktop.exe'
}
$kernelJson = & $Python (Join-Path $PSScriptRoot 'kernel.py') status --work-root $WorkRoot
if ($LASTEXITCODE -ne 0) { throw 'Kernel source/patch verification failed.' }
$kernelStatus = ($kernelJson -join "`n") | ConvertFrom-Json
if (-not $kernelStatus.runtimeBuilt -or -not $kernelStatus.nativeImportCppunitPassed) {
    throw 'Build and native test receipts must match the current patch stack.'
}
$engine = Join-Path (Resolve-Path -LiteralPath $WorkRoot).Path 'build\instdir\program\soffice.com'
$desktop = (Resolve-Path -LiteralPath $DesktopExecutable).Path
if (-not (Test-Path -LiteralPath $desktop -PathType Leaf)) { throw 'Build the desktop application first.' }
$result = [ordered]@{
    kernelId = $kernelStatus.kernelId
    command = $engine
    desktopExecutable = $desktop
    visualFidelityApproved = [bool]$kernelStatus.visualFidelityApproved
    mode = 'development'
}
if (-not $CheckOnly) {
    $previousOfficePath = $env:TOOLKNIT_LIBREOFFICE_PATH
    try {
        $env:TOOLKNIT_LIBREOFFICE_PATH = $engine
        $desktopProcess = Start-Process -FilePath $desktop -WorkingDirectory $projectRoot -PassThru
        $result.processId = $desktopProcess.Id
    } finally {
        $env:TOOLKNIT_LIBREOFFICE_PATH = $previousOfficePath
    }
}
$result | ConvertTo-Json
