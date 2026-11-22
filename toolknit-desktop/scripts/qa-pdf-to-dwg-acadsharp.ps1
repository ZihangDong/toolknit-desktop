#requires -Version 7.4
param(
  [string]$AssemblyPath = 'tmp/tk016/acadsharp-3.8.35/lib/net8.0/ACadSharp.dll',
  [string]$PrototypeReport = 'tmp/tk016/prototype-qa/report.json',
  [string]$Snapshot
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskAssembly = (Resolve-Path -LiteralPath $AssemblyPath).Path
$taskReportPath = (Resolve-Path -LiteralPath $PrototypeReport).Path
$taskReport = Get-Content -LiteralPath $taskReportPath -Raw -Encoding utf8 | ConvertFrom-Json
$taskRunRoot = [System.IO.Path]::GetFullPath((Join-Path (Split-Path $taskReportPath) $taskReport.artifactRun))
$taskRootPrefix = $taskRunRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$taskOutput = Join-Path $taskRunRoot ('acadsharp-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskOutput | Out-Null
Add-Type -Path $taskAssembly

function Get-GeometrySnapshot($Document) {
  $taskEntities = foreach ($taskEntity in $Document.Entities) {
    $taskItem = [ordered]@{ type = $taskEntity.ObjectName; layer = $taskEntity.Layer.Name }
    switch ($taskEntity.ObjectName) {
      'LINE' {
        $taskItem.start = @($taskEntity.StartPoint.X, $taskEntity.StartPoint.Y, $taskEntity.StartPoint.Z)
        $taskItem.end = @($taskEntity.EndPoint.X, $taskEntity.EndPoint.Y, $taskEntity.EndPoint.Z)
      }
      'TEXT' {
        $taskItem.text = $taskEntity.Value
        $taskItem.insert = @($taskEntity.InsertPoint.X, $taskEntity.InsertPoint.Y, $taskEntity.InsertPoint.Z)
        $taskItem.height = $taskEntity.Height
        $taskItem.rotation = $taskEntity.Rotation
        $taskItem.widthFactor = $taskEntity.WidthFactor
        $taskItem.fontFile = $taskEntity.Style.Filename
        $taskItem.horizontalAlignment = [int]$taskEntity.HorizontalAlignment
      }
      'SPLINE' {
        $taskItem.degree = $taskEntity.Degree
        $taskItem.controls = @($taskEntity.ControlPoints | ForEach-Object { ,@($_.X, $_.Y, $_.Z) })
        $taskItem.knots = @($taskEntity.Knots)
      }
      default { throw "Unexpected geometry type $($taskEntity.ObjectName)" }
    }
    [pscustomobject]$taskItem
  }
  [pscustomobject]@{ units = [int]$Document.Header.InsUnits; entities = @($taskEntities) } | ConvertTo-Json -Depth 12 -Compress
}

$taskResults = foreach ($taskScenario in $taskReport.scenarios) {
  if ($taskScenario.scenario -notmatch '^[a-z0-9-]+$') { throw 'Invalid scenario name' }
  $taskSource = [System.IO.Path]::GetFullPath((Join-Path $taskRunRoot $taskScenario.artifact))
  if (-not $taskSource.StartsWith($taskRootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Artifact path escaped the test run' }
  $taskBeforeHash = (Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash
  $taskNotifications = [System.Collections.Generic.List[object]]::new()
  $taskHandler = [ACadSharp.IO.NotificationEventHandler] {
    param($sender, $eventArgs)
    $taskNotifications.Add([pscustomobject]@{ type = $eventArgs.NotificationType.ToString(); message = $eventArgs.Message })
  }
  $taskDocument = [ACadSharp.IO.DwgReader]::Read($taskSource, $taskHandler)
  $taskExpectedCount = [int]$taskScenario.entities.LINE + [int]$taskScenario.entities.SPLINE + [int]$taskScenario.entities.TEXT
  if ($taskDocument.Entities.Count -ne $taskExpectedCount) { throw 'Entity count did not match the original conversion' }
  if ([int]$taskDocument.Header.InsUnits -ne [int]$taskScenario.units) { throw 'Drawing units changed' }
  if ([int]$taskScenario.entities.TEXT -gt 0) {
    foreach ($taskAsset in @($taskReport.font.file, $taskReport.font.licenseFile, 'FONT-README.txt')) {
      if ([System.IO.Path]::GetFileName($taskAsset) -ne $taskAsset) { throw 'Invalid font asset name' }
      $taskAssetSource = Join-Path (Split-Path $taskSource) $taskAsset
      $taskAssetDestination = Join-Path $taskOutput $taskAsset
      if (Test-Path -LiteralPath $taskAssetDestination) {
        if ((Get-FileHash -LiteralPath $taskAssetDestination).Hash -ne (Get-FileHash -LiteralPath $taskAssetSource).Hash) { throw 'Font assets disagree across drawings' }
      } else { Copy-Item -LiteralPath $taskAssetSource -Destination $taskAssetDestination }
    }
    if ((Get-FileHash -LiteralPath (Join-Path $taskOutput $taskReport.font.file)).Hash.ToLowerInvariant() -ne $taskReport.font.sha256) { throw 'Font asset changed' }
  }
  $taskEntity = @($taskDocument.Entities)[0]
  switch ($taskEntity.ObjectName) {
    'LINE' { $taskEntity.EndPoint = [CSMath.XYZ]::new($taskEntity.EndPoint.X + 1, $taskEntity.EndPoint.Y, $taskEntity.EndPoint.Z) }
    'TEXT' { $taskEntity.Value += ' [QA]' }
    'SPLINE' {
      $taskControl = $taskEntity.ControlPoints[1]
      $taskEntity.ControlPoints[1] = [CSMath.XYZ]::new($taskControl.X + 1, $taskControl.Y, $taskControl.Z)
    }
    default { throw 'No supported editable entity' }
  }
  $taskExpected = Get-GeometrySnapshot $taskDocument
  $taskDestination = Join-Path $taskOutput ($taskScenario.scenario + '-' + $taskScenario.page + '.dwg')
  [ACadSharp.IO.DwgWriter]::Write($taskDestination, $taskDocument, $null, $taskHandler)
  $taskReopened = [ACadSharp.IO.DwgReader]::Read($taskDestination, $taskHandler)
  if ((Get-GeometrySnapshot $taskReopened) -cne $taskExpected) { throw "Geometry changed after saving $($taskScenario.scenario)" }
  if ($taskNotifications.Count -ne 0) { throw ($taskNotifications | ConvertTo-Json -Depth 4) }
  if ((Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash -ne $taskBeforeHash) { throw 'Original DWG changed' }
  [pscustomobject]@{ scenario = $taskScenario.scenario; page = $taskScenario.page; entities = $taskExpectedCount;
    editedType = $taskEntity.ObjectName; notifications = $taskNotifications.Count; units = [int]$taskReopened.Header.InsUnits;
    originalPreserved = $true; fontAssetsPreserved = $true; status = 'read-edit-save-reopen-passed' }
}
$taskAcceptance = [ordered]@{
  task = 'TK-016-A'; scope = 'programmatic-library-acceptance'; sourceRun = $taskReport.artifactRun
  engine = 'ACadSharp 3.8.35 net8.0'; assemblySha256 = (Get-FileHash -LiteralPath $taskAssembly -Algorithm SHA256).Hash.ToLowerInvariant()
  cases = @($taskResults); status = 'programmatic-read-edit-save-reopen-passed'
  textLayout = 'portable-font-cap-height-width-factor'; fontSha256 = $taskReport.font.sha256
  interactiveCadAcceptance = 'not-tested'; productionPdfDrawings = 'not-available'
}
$taskJson = $taskAcceptance | ConvertTo-Json -Depth 8
$taskJson | Set-Content -LiteralPath (Join-Path (Split-Path $taskReportPath) 'acadsharp-report.json') -Encoding utf8
if ($Snapshot) { $taskJson | Set-Content -LiteralPath ([System.IO.Path]::GetFullPath($Snapshot)) -Encoding utf8 }
Write-Output "ACadSharp: $(@($taskResults).Count) programmatic read/edit/save/reopen checks passed; interactive CAD not tested."
