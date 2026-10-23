param([string]$Compiler = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe")
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path $PSScriptRoot -Parent
$id = [guid]::NewGuid().ToString('N')
$taskRoot = Join-Path $desktopRoot "tmp\upgrade-native-$id"
$oldDir = Join-Path $taskRoot ('old app ' + [char]0x65e7)
$newDir = Join-Path $taskRoot 'new app'
$productSubkey = "Software\ToolKnit-Upgrade-QA\$id"
$uninstallSubkey = "Software\Microsoft\Windows\CurrentVersion\Uninstall\ToolKnit-Upgrade-QA-$id"
$helperPath = Join-Path $desktopRoot 'src-tauri\windows\upgrade.nsh'
$results = [System.Collections.Generic.List[object]]::new()
New-Item -ItemType Directory -Path $oldDir,$newDir | Out-Null
function Assert([bool]$value, [string]$message) { if (-not $value) { throw $message } }
function Write-Source([string]$path, [string]$text) { [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false)) }
function Compile([string]$path) {
  & $Compiler /V2 /INPUTCHARSET UTF8 $path *> "$path.log"
  Assert ($LASTEXITCODE -eq 0) "NSIS compile failed: $path.log"
}
function Run([string]$path, [IO.FileStream]$releaseLock = $null, [bool]$removeReleasedFile = $false) {
  $process = Start-Process -FilePath $path -ArgumentList '/S' -WindowStyle Hidden -PassThru
  if ($releaseLock) {
    Start-Sleep -Milliseconds 1600
    $releaseLock.Dispose()
    if ($removeReleasedFile) { Remove-Item -LiteralPath (Join-Path $oldDir 'qa-app.exe') }
  }
  if (-not $process.WaitForExit(30000)) { Stop-Process -Id $process.Id; throw "Isolated fixture timed out: $path" }
  $process.Refresh()
  return $process.ExitCode
}
function Clear-Registration {
  foreach ($key in @($productSubkey,$uninstallSubkey)) {
    Assert ($key.EndsWith($id)) 'Refusing cleanup outside the fixture identity'
    if (Test-Path -LiteralPath "HKCU:\$key") { Remove-Item -LiteralPath "HKCU:\$key" -Recurse }
  }
}
$oldResult = $env:TOOLKNIT_UPGRADE_QA_RESULT
$oldMode = $env:TOOLKNIT_UPGRADE_QA_MODE
try {
  $stub = @"
Unicode true
RequestExecutionLevel user
SilentInstall silent
!include FileFunc.nsh
OutFile "$oldDir\uninstall.exe"
Section
  `${GetParameters} `$1
  WriteINIStr "$taskRoot\arguments.ini" "call" "arguments" `$1
  ReadEnvStr `$0 "TOOLKNIT_UPGRADE_QA_RESULT"
  StrCmp `$0 "leave-file" leave
  StrCmp `$0 "0" 0 finish
  Delete "$oldDir\qa-app.exe"
  finish:
  SetErrorLevel `$0
  Quit
  leave:
  SetErrorLevel 0
SectionEnd
"@
  Write-Source (Join-Path $taskRoot 'old-uninstaller.nsi') $stub
  Compile (Join-Path $taskRoot 'old-uninstaller.nsi')
  $parent = @"
Unicode true
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!include FileFunc.nsh
!include StrFunc.nsh
`${StrCase}
`${StrLoc}
!define UNINSTKEY "$uninstallSubkey"
!define MANUPRODUCTKEY "$productSubkey"
!define MAINBINARYNAME "qa-app"
!define PRODUCTNAME "ToolKnit-Upgrade-QA-$id"
!define TOOLKNIT_AUTOSTART_VALUE_NAME "ToolKnit-Upgrade-QA-$id"
!define INSTALLMODE "both"
Var MultiUser.InstallMode
Var WixMode
Var PassiveMode
!include "$helperPath"
OutFile "$taskRoot\upgrade-probe.exe"
Section
  SetShellVarContext current
  StrCpy `$INSTDIR "$newDir"
  StrCpy `$WixMode 0
  StrCpy `$PassiveMode 1
  StrCpy `$PreviousVersionComparison 1
  StrCpy `$MultiUser.InstallMode CurrentUser
  ReadEnvStr `$9 "TOOLKNIT_UPGRADE_QA_MODE"
  `${If} `$9 == "all-users"
    StrCpy `$MultiUser.InstallMode AllUsers
  `${EndIf}
  `${If} `$9 == "maintenance"
    StrCpy `$PreviousVersionComparison 0
  `${EndIf}
  Call PreparePreviousUninstaller
  `${If} `$9 == "msi"
    StrCpy `$WixMode 1
  `${EndIf}
  `${If} `$PreviousUninstallStatus == ""
    StrCpy `$ToolKnitFileToCheck "`$PreviousInstallDir\`$PreviousMainBinary"
    Call ToolKnitWaitForFileRelease
    `${If} `$ToolKnitFileError == 0
      ; Reproduce an earlier failed registry lookup without changing execution.
      SetErrors
      Call InvokePreviousUninstaller
    `${Else}
      StrCpy `$PreviousUninstallStatus "file-busy-or-denied"
      StrCpy `$PreviousUninstallExitCode `$ToolKnitFileError
    `${EndIf}
  `${EndIf}
  WriteINIStr "$taskRoot\result.ini" "result" "status" `$PreviousUninstallStatus
  WriteINIStr "$taskRoot\result.ini" "result" "code" `$PreviousUninstallExitCode
  WriteINIStr "$taskRoot\result.ini" "result" "directory" `$PreviousInstallDir
  WriteINIStr "$taskRoot\result.ini" "result" "command" `$PreviousUninstallCommand
SectionEnd
"@
  Write-Source (Join-Path $taskRoot 'upgrade-probe.nsi') $parent
  Compile (Join-Path $taskRoot 'upgrade-probe.nsi')
  $cases = @(
    @{Name='different-target';Status='';Result='0'},
    @{Name='missing-vendor-key';Status='';Result='0'},
    @{Name='unquoted-spaced-path';Status='';Result='0'},
    @{Name='install-location-fallback';Status='';Result='0'},
    @{Name='vendor-location-fallback';Status='';Result='0'},
    @{Name='all-users';Status='';Result='0';Mode='all-users'},
    @{Name='maintenance';Status='';Result='0';Mode='maintenance'},
    @{Name='cancelled';Status='cancelled';Result='1'},
    @{Name='failed-code';Status='exit-code';Result='1603'},
    @{Name='residual-old-file';Status='files-remain';Result='leave-file'},
    @{Name='msi-cancelled';Status='cancelled';Result='1602';Mode='msi'},
    @{Name='msi-reboot-required';Status='reboot-required';Result='3010';Mode='msi'},
    @{Name='msi-reboot-initiated';Status='reboot-required';Result='1641';Mode='msi'},
    @{Name='missing-uninstaller';Status='uninstaller-missing';Result='0'},
    @{Name='invalid-executable';Status='launch-failed';Result='0'},
    @{Name='malformed-command';Status='invalid-uninstall-path';Result='0'},
    @{Name='drive-relative-command';Status='invalid-uninstall-path';Result='0'},
    @{Name='missing-metadata';Status='metadata-missing';Result='0'},
    @{Name='delayed-file-release';Status='';Result='0';Lock='release'},
    @{Name='file-removed-during-wait';Status='';Result='0';Lock='remove'},
    @{Name='persistent-file-lock';Status='file-busy-or-denied';Result='0';Lock='hold'}
  )
  foreach ($case in $cases) {
    Clear-Registration
    $registration = New-Item -Path "HKCU:\$uninstallSubkey" -Force
    $command = '"' + $oldDir + '\uninstall.exe"'
    if ($case.Name -eq 'unquoted-spaced-path') { $command = "$oldDir\uninstall.exe /P" }
    if ($case.Name -eq 'malformed-command') { $command = '"unterminated command' }
    if ($case.Name -eq 'drive-relative-command') { $command = '"C:relative\uninstall.exe"' }
    if ($case.Name -eq 'missing-uninstaller') { $command = '"' + $taskRoot + '\missing app\uninstall.exe"' }
    if ($case.Name -eq 'invalid-executable') {
      $invalidDir = Join-Path $taskRoot 'invalid app'
      New-Item -Path $invalidDir -ItemType Directory -Force | Out-Null
      Write-Source (Join-Path $invalidDir 'uninstall.exe') 'Not an executable'
      $command = '"' + $invalidDir + '\uninstall.exe"'
    }
    if ($case.Name -notin @('install-location-fallback','vendor-location-fallback','missing-metadata')) {
      New-ItemProperty -LiteralPath $registration.PSPath -Name UninstallString -Value $command | Out-Null
    }
    if ($case.Name -eq 'install-location-fallback') { New-ItemProperty -LiteralPath $registration.PSPath -Name InstallLocation -Value ('"' + $oldDir + '"') | Out-Null }
    if ($case.Name -in @('different-target','vendor-location-fallback')) {
      New-Item -Path "HKCU:\$productSubkey" -Force | Out-Null
      Set-Item -LiteralPath "HKCU:\$productSubkey" -Value $oldDir
    }
    Write-Source (Join-Path $oldDir 'qa-app.exe') 'old fixture'
    Write-Source (Join-Path $oldDir 'user-data.txt') 'preserve this fixture'
    Write-Source (Join-Path $newDir 'qa-app.exe') 'new destination must remain untouched'
    foreach ($file in @('result.ini','arguments.ini')) { Remove-Item -LiteralPath (Join-Path $taskRoot $file) -ErrorAction SilentlyContinue }
    $env:TOOLKNIT_UPGRADE_QA_RESULT = $case.Result
    $env:TOOLKNIT_UPGRADE_QA_MODE = $case.Mode
    $lock = $null
    try {
      if ($case.Lock) { $lock = [IO.File]::Open((Join-Path $oldDir 'qa-app.exe'), 'Open', 'Read', 'Read') }
      $exitCode = if ($case.Lock -in @('release','remove')) { Run (Join-Path $taskRoot 'upgrade-probe.exe') $lock ($case.Lock -eq 'remove') } else { Run (Join-Path $taskRoot 'upgrade-probe.exe') }
      Assert ($exitCode -eq 0) "$($case.Name): probe failed with $exitCode"
    } finally { if ($lock) { $lock.Dispose() } }
    $ini = Get-Content -LiteralPath (Join-Path $taskRoot 'result.ini')
    $status = ($ini | Where-Object { $_.StartsWith('status=') }).Substring(7)
    $code = ($ini | Where-Object { $_.StartsWith('code=') }).Substring(5)
    Assert ($status -eq $case.Status) "$($case.Name): expected '$($case.Status)', got '$status' ($code)"
    if ($case.Status -eq '') {
      Assert (-not (Test-Path -LiteralPath (Join-Path $oldDir 'qa-app.exe'))) "$($case.Name): old executable remains"
      $argsText = Get-Content -LiteralPath (Join-Path $taskRoot 'arguments.ini') -Raw
      $scope = if ($case.Mode -eq 'all-users') { '/AllUsers' } else { '/CurrentUser' }
      Assert ($argsText.Contains($scope)) "$($case.Name): missing explicit scope"
      Assert ($argsText.Contains("_?=$oldDir")) "$($case.Name): wrong old directory"
      Assert ($argsText.Contains('/UPDATE') -eq ($case.Mode -ne 'maintenance')) "$($case.Name): wrong data-preservation mode"
    }
    Assert ((Get-Content -LiteralPath (Join-Path $newDir 'qa-app.exe') -Raw) -eq 'new destination must remain untouched') 'New destination was modified'
    Assert ((Get-Content -LiteralPath (Join-Path $oldDir 'user-data.txt') -Raw) -eq 'preserve this fixture') 'User-data fixture was modified'
    $results.Add([pscustomobject]@{case=$case.Name;status=$status;code=$code})
    Write-Output "PASS $($case.Name)"
  }
} finally {
  Clear-Registration
  $env:TOOLKNIT_UPGRADE_QA_RESULT = $oldResult
  $env:TOOLKNIT_UPGRADE_QA_MODE = $oldMode
  $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRoot 'results.json') -Encoding utf8
  Write-Output "Evidence: $taskRoot"
}
