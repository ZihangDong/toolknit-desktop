param(
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [ValidateSet('Configure', 'Fetch', 'Compile', 'Build', 'Test')][string]$Stage = 'Configure',
    [string[]]$CompileTargets = @('Library_sw'),
    [string]$WslDistro = 'Ubuntu',
    [ValidateRange(1, 16)][int]$Jobs = 4,
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($WorkRoot) -or $WorkRoot -match '[^\x20-\x7e]|\s') {
    throw 'Use an absolute ASCII work path without spaces, such as D:\tk-lo.'
}
if ($WslDistro -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid WSL distribution name.' }
$work = [IO.Path]::GetFullPath($WorkRoot)
& $Python (Join-Path $PSScriptRoot 'kernel.py') prepare --work-root $work
if ($LASTEXITCODE -ne 0) { throw 'Pinned source/patch verification failed.' }
$gitExe = (Get-Command git.exe -ErrorAction Stop).Source
$gitRoot = Split-Path (Split-Path $gitExe -Parent) -Parent
foreach ($needed in @('tools\make.exe', 'tools\pkgconf-2.4.3.exe', 'perl\perl\bin\perl.exe', 'llvm\bin\clang-cl.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $work $needed))) { throw ('Missing build tool: ' + $needed) }
}
$toolLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'kernel.lock.json') -Raw | ConvertFrom-Json
$llvmTool = $toolLock.windowsBuildTools | Where-Object { $_.file -eq 'LLVM-20.1.8-win64.exe' }
if ((Get-FileHash -LiteralPath (Join-Path $work 'llvm\bin\clang-cl.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $llvmTool.clangClSha256) {
    throw 'Portable clang-cl executable checksum mismatch.'
}
$originalPath = $env:PATH
$originalLocale = $env:LC_ALL
$originalMsystem = $env:MSYSTEM
$originalCompilerOptions = $env:CL
$originalNodeReuse = $env:MSBUILDDISABLENODEREUSE
$env:PATH = "$work\tools;$work\llvm\bin;$work\perl\perl\bin;$work\perl\c\bin;$gitRoot\mingw64\bin;$gitRoot\usr\bin;$env:PATH"
$env:LC_ALL = 'C'
$env:MSYSTEM = 'MINGW64'
# Some upstream C dependencies bypass gbuild's UTF-8 flags. Keep MSVC source
# decoding independent of the Windows display language and active code page.
$env:CL = ($originalCompilerOptions + ' -utf-8').Trim()
$env:MSBUILDDISABLENODEREUSE = '1'
Push-Location (Join-Path $work 'build')
try {
    if ($Stage -eq 'Configure') {
        $forwardWork = $work.Replace('\', '/')
        $unixWork = & wsl.exe -d $WslDistro -- wslpath -u $forwardWork
        if ($LASTEXITCODE -ne 0 -or -not $unixWork -or -not $unixWork.Trim().StartsWith('/mnt/')) { throw 'Could not resolve WSL work path.' }
        $unixWork = $unixWork.Trim()
        $options = @(
            '--host=x86_64-pc-cygwin', '--with-visual-studio=2022',
            "--with-strawberry-perl-portable=$forwardWork/perl", "--with-wsl-command=wsl.exe -d $WslDistro",
            '--enable-python=fully-internal', '--without-lxml', '--without-java', '--disable-cli',
            '--disable-online-update', '--disable-ccache', '--without-help', '--without-myspell-dicts',
            "--with-external-tar=$forwardWork/external", "--with-parallelism=$Jobs",
            '--enable-symbols=no', '--disable-debug', '--disable-pdfimport',
            '--without-fonts', '--disable-firebird-sdbc', '--disable-mariadb-sdbc',
            '--disable-postgresql-sdbc', '--with-galleries=no',
            '--with-gnu-cp=/usr/bin/cp',
            'LO_CLANG_CC=clang-cl.exe --target=x86_64-pc-windows-msvc -m64',
            'LO_CLANG_CXX=clang-cl.exe --target=x86_64-pc-windows-msvc -m64',
            'LO_CLANG_SHOWINCLUDES_PREFIX=Note: including file:',
            "PKG_CONFIG=$unixWork/tools/pkgconf-2.4.3.exe"
        )
        [IO.File]::WriteAllLines((Join-Path $work 'build\autogen.input'), $options, [Text.UTF8Encoding]::new($false))
        & wsl.exe -d $WslDistro -- /usr/bin/perl "$unixWork/src/autogen.sh"
    } elseif ($Stage -eq 'Fetch') {
        & $Python (Join-Path $PSScriptRoot 'prefetch.py') --work-root $work --jobs ([Math]::Min($Jobs, 8))
    } elseif ($Stage -eq 'Compile') {
        foreach ($compileTarget in $CompileTargets) {
            if ($compileTarget -notmatch '^(Library|CppunitTest)_[A-Za-z0-9_]+$') { throw 'Invalid incremental compile target.' }
        }
        if (-not $CompileTargets.Count) { throw 'An incremental compile target is required.' }
        & (Join-Path $work 'tools\make.exe') "-j$Jobs" @CompileTargets
    } elseif ($Stage -eq 'Build') {
        & (Join-Path $work 'tools\make.exe') "-j$Jobs" build
    } else {
        $kernelLock = Get-Content (Join-Path $PSScriptRoot 'kernel.lock.json') -Raw | ConvertFrom-Json
        $testNames = $kernelLock.cppunitTestNames -join ' '
        if (-not $testNames -or $testNames -notmatch '^[A-Za-z0-9_ ]+$') { throw 'Invalid native test selection.' }
        & (Join-Path $work 'tools\make.exe') "-j$Jobs" @($kernelLock.cppunitTargets) "CPPUNIT_TEST_NAME=$testNames"
    }
    if ($LASTEXITCODE -ne 0) { throw ('LibreOffice stage failed: ' + $Stage) }
    if ($Stage -in @('Build', 'Test')) {
        & $Python (Join-Path $PSScriptRoot 'kernel.py') record-stage --work-root $work --stage $Stage
        if ($LASTEXITCODE -ne 0) { throw 'Could not record the completed build stage.' }
    }
} finally {
    Pop-Location
    $env:PATH = $originalPath
    $env:LC_ALL = $originalLocale
    $env:MSYSTEM = $originalMsystem
    $env:CL = $originalCompilerOptions
    $env:MSBUILDDISABLENODEREUSE = $originalNodeReuse
}
