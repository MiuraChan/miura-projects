param(
  [switch]$SkipPython,
  [switch]$SkipModels
)

$ErrorActionPreference = "Stop"
if (-not $SkipPython) {
  & (Join-Path $PSScriptRoot "build-python-runtimes.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Python runtime preparation failed." }
}
if (-not $SkipModels) {
  & (Join-Path $PSScriptRoot "prepare-models.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Model preparation failed." }
}

& (Join-Path $PSScriptRoot "build-llama-launcher.ps1")
if ($LASTEXITCODE -ne 0) { throw "Llama launcher preparation failed." }

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $projectRoot
try {
  & node "packaging\check-runtime.mjs"
  if ($LASTEXITCODE -ne 0) { throw "Standalone runtime validation failed." }
} finally {
  Pop-Location
}
