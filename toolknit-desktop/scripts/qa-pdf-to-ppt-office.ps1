param(
    [string]$ArtifactDirectory = (Join-Path $PSScriptRoot '../tmp/pdf-ppt-browser')
)
$ErrorActionPreference = 'Stop'
$artifactRoot = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$wasRunning = @(Get-Process POWERPNT,wpp -ErrorAction SilentlyContinue).Count -gt 0
$application = $null
$presentation = $null
$checks = @()
$registeredExecutable = [Microsoft.Win32.Registry]::GetValue('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\POWERPNT.EXE', '', '')
try {
    # A registered PowerPoint-compatible automation server may be supplied by WPS.
    $application = New-Object -ComObject PowerPoint.Application
    $application.DisplayAlerts = 1
    foreach ($case in @(
        @{ File = 'all-light-zh.pptx'; Count = 4; Ratio = 0.75 },
        @{ File = 'subset.pptx'; Count = 2; Ratio = (640.0 / 360.0) },
        @{ File = '300dpi.pptx'; Count = 1; Ratio = 0.75 }
    )) {
        $source = (Resolve-Path -LiteralPath (Join-Path $artifactRoot $case.File)).Path
        $presentation = $application.Presentations.Open($source, $true, $false, $false)
        if ($presentation.Slides.Count -ne $case.Count) { throw "Unexpected slide count: $source" }
        $width = [double]$presentation.PageSetup.SlideWidth
        $height = [double]$presentation.PageSetup.SlideHeight
        if ([Math]::Abs($width / $height - $case.Ratio) -gt 0.001) { throw "Unexpected slide ratio: $source" }
        for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
            $slide = $presentation.Slides.Item($index)
            if ($slide.Shapes.Count -ne 1) { throw "Expected one image on slide $index" }
            $picture = $slide.Shapes.Item(1)
            if ($picture.Type -ne 13) { throw "Expected an editable picture on slide $index" }
            if ($picture.Left -lt -0.1 -or $picture.Top -lt -0.1 -or
                $picture.Left + $picture.Width -gt $width + 0.1 -or
                $picture.Top + $picture.Height -gt $height + 0.1) { throw "Picture outside slide $index" }
        }
        $pdf = Join-Path $artifactRoot ($case.File -replace '\.pptx$', '-office.pdf')
        $presentation.SaveAs($pdf, 32)
        if (!(Test-Path -LiteralPath $pdf) -or (Get-Item -LiteralPath $pdf).Length -lt 1000) { throw 'Office PDF export failed' }
        $checks += @{ file = $case.File; slides = $case.Count; width = $width; height = $height; pdf = $pdf }
        $presentation.Close()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
        $presentation = $null
    }
    @{ application = [string]$application.Name; version = [string]$application.Version; executable = $registeredExecutable; passed = $true; checks = $checks } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $artifactRoot 'office-report.json') -Encoding utf8
    Write-Output "Office-compatible application opened 3 generated decks and exported their PDFs."
} finally {
    if ($null -ne $presentation) {
        $presentation.Close()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
    }
    if ($null -ne $application) {
        if (!$wasRunning) { $application.Quit() }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
    }
}
