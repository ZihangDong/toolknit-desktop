[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$TestExecutable)

$ErrorActionPreference = 'Stop'
$locationProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$locationExe = (Resolve-Path -LiteralPath $TestExecutable).Path
$locationTarget = [IO.Path]::GetFullPath((Join-Path $locationProject 'src-tauri/target')) + [IO.Path]::DirectorySeparatorChar
if (-not $locationExe.StartsWith($locationTarget, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($locationExe) -notlike 'toolknit_desktop_lib-*.exe') {
    throw 'Use the current project Cargo library test executable.'
}
$locationOutput = Join-Path $locationProject 'tmp/open-location-native'
[IO.Directory]::CreateDirectory($locationOutput) | Out-Null
$locationTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$locationRoot = [IO.Path]::GetFullPath((Join-Path $locationTemp ('toolknit-location-qa-' + [guid]::NewGuid().ToString('N'))))
[IO.Directory]::CreateDirectory($locationRoot) | Out-Null
$locationShell = New-Object -ComObject Shell.Application
$locationBefore = @($locationShell.Windows() | ForEach-Object { try { [long]$_.HWND } catch {} })
$locationPreviousPath = $env:TOOLKNIT_OPEN_LOCATION_QA_PATH
$locationPreviousCommand = $env:TOOLKNIT_OPEN_LOCATION_QA_COMMAND
$locationReport = @()

function Normalize-LocationPath([string]$Value) {
    if ($Value.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) { $Value = '\\' + $Value.Substring(8) }
    elseif ($Value.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) { $Value = $Value.Substring(4) }
    return $Value.TrimEnd('\')
}

try {
    $locationPlain = Join-Path $locationRoot 'plain.txt'
    $locationSpaced = Join-Path $locationRoot 'file with spaces.txt'
    $locationComma = Join-Path $locationRoot 'invoice,final.csv'
    $locationMixed = Join-Path $locationRoot '合同, 终稿(1) 😀 & # 100%.txt'
    $locationFolder = Join-Path $locationRoot '目录 空格, (1) & # 100%'
    $locationNested = Join-Path $locationFolder '结果 文件, (2).pdf'
    $locationOpenOnly = Join-Path $locationRoot 'empty directory, (3)'
    $locationAlias = Join-Path $locationRoot 'legacy command, only.txt'
    $locationSearch = Join-Path $locationRoot 'file search, only.txt'
    $locationCmd = Join-Path $locationRoot 'select only.cmd'
    $locationLink = Join-Path $locationRoot 'shortcut, with spaces.lnk'
    [IO.Directory]::CreateDirectory($locationFolder) | Out-Null
    [IO.Directory]::CreateDirectory($locationOpenOnly) | Out-Null
    foreach ($locationFile in @($locationPlain, $locationSpaced, $locationComma, $locationMixed, $locationNested, $locationAlias, $locationSearch)) {
        [IO.File]::WriteAllText($locationFile, 'Synthetic ToolKnit location fixture. Original content must remain unchanged.')
    }
    [IO.File]::WriteAllText($locationCmd, '@echo off' + [Environment]::NewLine + 'echo executed>"%~dp0executed-marker.txt"')
    $locationWsh = New-Object -ComObject WScript.Shell
    $locationShortcut = $locationWsh.CreateShortcut($locationLink)
    $locationShortcut.TargetPath = $locationPlain
    $locationShortcut.Save()
    $locationHashes = @{}
    Get-ChildItem -LiteralPath $locationRoot -Recurse -File | ForEach-Object {
        $locationHashes[$_.FullName] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
    $locationCases = @(
        @{name='ordinary-file'; path=$locationPlain; folder=$locationRoot; command='open_path'; select=$true},
        @{name='spaces'; path=$locationSpaced; folder=$locationRoot; command='open_path'; select=$true},
        @{name='comma'; path=$locationComma; folder=$locationRoot; command='open_path'; select=$true},
        @{name='unicode-punctuation'; path=$locationMixed; folder=$locationRoot; command='open_path'; select=$true},
        @{name='nested-folder'; path=$locationNested; folder=$locationFolder; command='open_path'; select=$true},
        @{name='directory'; path=$locationOpenOnly; folder=$locationOpenOnly; command='open_path'; select=$false},
        @{name='legacy-command-alias'; path=$locationAlias; folder=$locationRoot; command='reveal_in_folder'; select=$true},
        @{name='file-search-shared-boundary'; path=$locationSearch; folder=$locationRoot; command='file_search'; select=$true},
        @{name='select-executable-without-running'; path=$locationCmd; folder=$locationRoot; command='open_path'; select=$true},
        @{name='select-shortcut-without-following'; path=$locationLink; folder=$locationRoot; command='open_path'; select=$true}
    )
    foreach ($locationCase in $locationCases) {
        $env:TOOLKNIT_OPEN_LOCATION_QA_PATH = $locationCase.path
        $env:TOOLKNIT_OPEN_LOCATION_QA_COMMAND = $locationCase.command
        $locationRun = & $locationExe open_path_native_explorer_qa --ignored --nocapture --test-threads=1 2>&1
        if ($LASTEXITCODE -ne 0 -or ($locationRun -join "`n") -notmatch '1 passed; 0 failed') {
            throw ('Native request failed: ' + $locationCase.name)
        }
        $locationMatched = $false
        $locationWatch = [Diagnostics.Stopwatch]::StartNew()
        while ($locationWatch.Elapsed.TotalSeconds -lt 8 -and -not $locationMatched) {
            foreach ($locationWindow in @($locationShell.Windows())) {
                try {
                    if ([IO.Path]::GetFileName([string]$locationWindow.FullName) -ine 'explorer.exe') { continue }
                    $locationShown = Normalize-LocationPath ([string]$locationWindow.Document.Folder.Self.Path)
                    if ($locationShown -ine (Normalize-LocationPath $locationCase.folder)) { continue }
                    $locationSelected = @($locationWindow.Document.SelectedItems() | ForEach-Object { Normalize-LocationPath ([string]$_.Path) })
                    if (-not $locationCase.select -or (Normalize-LocationPath $locationCase.path) -in $locationSelected) { $locationMatched=$true; break }
                } catch {}
            }
            if (-not $locationMatched) { Start-Sleep -Milliseconds 150 }
        }
        if (-not $locationMatched) { throw ('Explorer did not show the expected location/selection: ' + $locationCase.name) }
        $locationReport += [PSCustomObject]@{case=$locationCase.name;folderMatched=$true;selectionRequired=[bool]$locationCase.select;passed=$true}
    }
    if (Test-Path -LiteralPath (Join-Path $locationRoot 'executed-marker.txt')) { throw 'A selected file was executed.' }
    foreach ($locationFile in $locationHashes.Keys) {
        if ((Get-FileHash -LiteralPath $locationFile -Algorithm SHA256).Hash -ne $locationHashes[$locationFile]) { throw 'Fixture content changed.' }
    }
    [PSCustomObject]@{passed=$true;realExplorerObserved=$true;cases=$locationReport;originalFilesUnchanged=$true;filesNotExecuted=$true} |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $locationOutput 'report.json') -Encoding utf8
    Write-Output ('Native Explorer location QA passed: ' + $locationReport.Count + ' actual folder/selection checks; files unchanged and not executed.')
} finally {
    $env:TOOLKNIT_OPEN_LOCATION_QA_PATH = $locationPreviousPath
    $env:TOOLKNIT_OPEN_LOCATION_QA_COMMAND = $locationPreviousCommand
    foreach ($locationWindow in @($locationShell.Windows())) {
        try {
            if ([long]$locationWindow.HWND -notin $locationBefore) {
                $locationShown = Normalize-LocationPath ([string]$locationWindow.Document.Folder.Self.Path)
                if ($locationShown -ieq $locationRoot -or $locationShown.StartsWith($locationRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
                    $locationWindow.Quit()
                }
            }
        } catch {}
    }
    $locationCleanup = [IO.Path]::GetFullPath($locationRoot)
    if (-not $locationCleanup.StartsWith($locationTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Path]::GetFileName($locationCleanup).StartsWith('toolknit-location-qa-') -or
        ((Get-Item -LiteralPath $locationCleanup).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing cleanup outside the verified temporary fixture directory.'
    }
    Remove-Item -LiteralPath $locationCleanup -Recurse -Force
}
