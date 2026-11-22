$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bundle = Join-Path $root 'src-tauri/resources/office-kernel'
$verify = Join-Path $PSScriptRoot 'verify-office-kernel.mjs'

function Assert-Kernel([string]$Directory) {
    & node $verify $Directory
    if ($LASTEXITCODE -ne 0) { throw 'Office kernel verification failed.' }
}

if (Test-Path -LiteralPath $bundle) {
    Assert-Kernel $bundle
    exit 0
}

$scratch = Join-Path (Split-Path -Parent $bundle) ('.office-kernel-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $scratch 'verified'
$null = New-Item -ItemType Directory -Path $stage
try {
    $archive = $env:TOOLKNIT_OFFICE_KERNEL_ARCHIVE
    if (!$archive) {
        $url = $env:TOOLKNIT_OFFICE_KERNEL_URL
        $uri = $null
        if (![Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo) {
            throw 'Set TOOLKNIT_OFFICE_KERNEL_URL to an HTTPS ZIP or TOOLKNIT_OFFICE_KERNEL_ARCHIVE to a local ZIP.'
        }
        $archive = Join-Path $scratch 'office-kernel.zip'
        Invoke-WebRequest -Uri $uri -OutFile $archive -TimeoutSec 600 -MaximumRetryCount 2 -RetryIntervalSec 5
    }
    if ((Get-Item -LiteralPath $archive).Length -gt 800MB) { throw 'Office kernel archive is too large.' }
    $pin = Get-Content -Raw -LiteralPath (Join-Path $root 'office-kernel/runtime.lock.json') | ConvertFrom-Json
    $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $archive).Path)
    try {
        $manifestEntry = $zip.GetEntry('manifest.json')
        if (!$manifestEntry -or $manifestEntry.Length -gt 4MB) { throw 'Office kernel archive has no valid manifest.' }
        $manifestPath = Join-Path $stage 'manifest.json'
        [IO.Compression.ZipFileExtensions]::ExtractToFile($manifestEntry, $manifestPath)
        if ((Get-FileHash -LiteralPath $manifestPath).Hash -ne $pin.manifestSha256) { throw 'Office kernel manifest hash mismatch.' }
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json -AsHashtable
        $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $total = 0L
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if ($name -match '(^/|:|(^|/)\.{1,2}(/|$)|//)' -or !$paths.Add($name)) {
                throw 'Unsafe or duplicate path in Office kernel archive.'
            }
            if ($name.EndsWith('/')) { continue }
            if ($name -ceq 'manifest.json') { continue }
            $expected = $manifest.files[$name]
            $total += $entry.Length
            if (!$expected -or $entry.Length -ne $expected.bytes -or $total -gt 1GB) {
                throw "Unexpected Office kernel archive entry: $name"
            }
            $destination = Join-Path $stage $name
            $null = New-Item -Force -ItemType Directory -Path (Split-Path -Parent $destination)
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination)
        }
    } finally { $zip.Dispose() }
    Assert-Kernel $stage
    Move-Item -LiteralPath $stage -Destination $bundle
} finally {
    $parent = [IO.Path]::GetFullPath((Split-Path -Parent $bundle))
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ((Split-Path -Parent $resolved) -eq $parent -and (Split-Path -Leaf $resolved).StartsWith('.office-kernel-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
