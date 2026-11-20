param(
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [string]$WslDistro = 'Ubuntu',
    [switch]$InstallWslPackages
)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($WorkRoot) -or $WorkRoot -match '[^\x20-\x7e]|\s') {
    throw 'Use an absolute ASCII work path without spaces, such as D:\tk-lo.'
}
if ($WslDistro -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid WSL distribution name.' }
$work = [IO.Path]::GetFullPath($WorkRoot)
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio 2022 C++ Build Tools with ATL is required.' }
$visualStudio = & $vswhere -latest -products '*' -version '[17.0,18.0)' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.ATL -property installationPath
if (-not $visualStudio) { throw 'Visual Studio 2022 requires C++ x64/x86 tools and ATL.' }
$lock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'kernel.lock.json') -Raw | ConvertFrom-Json
foreach ($name in @('downloads', 'tools', 'external', 'build')) {
    New-Item -ItemType Directory -Path (Join-Path $work $name) -Force | Out-Null
}
foreach ($tool in $lock.windowsBuildTools) {
    $archive = Join-Path $work ('downloads\' + $tool.file)
    if (-not (Test-Path -LiteralPath $archive)) {
        $partial = $archive + '.' + [Guid]::NewGuid().ToString('N') + '.part'
        & curl.exe --fail --location --silent --show-error --retry 2 --output $partial $tool.url
        if ($LASTEXITCODE -ne 0) { throw ('Build tool download failed: ' + $tool.file) }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $tool.sha256) {
            throw ('Build tool checksum mismatch: ' + $tool.file)
        }
        Move-Item -LiteralPath $partial -Destination $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $tool.sha256) {
        throw ('Existing build tool checksum mismatch: ' + $tool.file)
    }
}
Copy-Item -LiteralPath (Join-Path $work 'downloads\make-4.2.1-msvc.exe') -Destination (Join-Path $work 'tools\make.exe') -Force
Copy-Item -LiteralPath (Join-Path $work 'downloads\pkgconf-2.4.3.exe') -Destination (Join-Path $work 'tools\pkgconf-2.4.3.exe') -Force
$clang = Join-Path $work 'llvm\bin\clang-cl.exe'
if (-not (Test-Path -LiteralPath $clang)) {
    $sevenZip = Join-Path $env:ProgramFiles '7-Zip\7z.exe'
    if (-not (Test-Path -LiteralPath $sevenZip)) { throw '7-Zip is required to extract the pinned LLVM tool without installing it.' }
    & $sevenZip x (Join-Path $work 'downloads\LLVM-20.1.8-win64.exe') ("-o" + (Join-Path $work 'llvm')) 'bin\clang-cl.exe' 'lib\clang\20\include\*' 'lib\clang\20\lib\windows\*' -y
    if ($LASTEXITCODE -ne 0) { throw 'Portable LLVM extraction failed.' }
}
$llvmTool = $lock.windowsBuildTools | Where-Object { $_.file -eq 'LLVM-20.1.8-win64.exe' }
if ((Get-FileHash -LiteralPath $clang -Algorithm SHA256).Hash.ToLowerInvariant() -ne $llvmTool.clangClSha256) {
    throw 'Portable clang-cl executable checksum mismatch.'
}
$perl = Join-Path $work 'perl'
if (-not (Test-Path -LiteralPath (Join-Path $perl 'perl\bin\perl.exe'))) {
    if ((Test-Path -LiteralPath $perl) -and (Get-ChildItem -LiteralPath $perl | Select-Object -First 1)) {
        throw 'Portable Perl extraction is incomplete; existing files were left intact.'
    }
    Expand-Archive -LiteralPath (Join-Path $work 'downloads\strawberry-perl-5.40.0.1-64bit-portable.zip') -DestinationPath $perl
}
if ($InstallWslPackages) {
    & wsl.exe -d $WslDistro -u root -- bash -lc 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends pkg-config automake make gperf bison nasm flex zip libfont-ttf-perl libarchive-tools patch unzip ca-certificates curl'
    if ($LASTEXITCODE -ne 0) { throw 'WSL build dependency installation failed.' }
}
# Font::TTF and IO::String are pure Perl modules from the WSL build packages.
# Copy only these modules into the task-local portable interpreter.
& wsl.exe -d $WslDistro -- true
if ($LASTEXITCODE -ne 0) { throw 'The selected WSL distribution is unavailable.' }
$modules = "\\wsl.localhost\$WslDistro\usr\share\perl5"
if (-not (Test-Path -LiteralPath "$modules\Font\TTF.pm") -or -not (Test-Path -LiteralPath "$modules\IO\String.pm")) {
    throw 'Required pure Perl modules are missing; install the WSL build packages.'
}
$fontDirectory = Join-Path $perl 'perl\site\lib\Font'
$ioDirectory = Join-Path $perl 'perl\site\lib\IO'
New-Item -ItemType Directory -Path $fontDirectory, $ioDirectory -Force | Out-Null
Copy-Item -LiteralPath "$modules\Font\TTF.pm" -Destination $fontDirectory -Force
Copy-Item -LiteralPath "$modules\Font\TTF" -Destination $fontDirectory -Recurse -Force
Copy-Item -LiteralPath "$modules\IO\String.pm" -Destination $ioDirectory -Force
Write-Output ('Verified build tools are ready in ' + $work)
