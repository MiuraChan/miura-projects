param(
  [string]$Python = "C:\tmp\mei-stt-env\Scripts\python.exe",
  [string]$RuntimeRoot = "",
  [string]$DllBin = "C:\tmp\mei-miniforge\Library\bin"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:PYTHONNOUSERSITE = "1"
$env:SETUPTOOLS_USE_DISTUTILS = "stdlib"

if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $PSScriptRoot "runtime" }
$runtimeRootPath = [System.IO.Path]::GetFullPath($RuntimeRoot)
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if (-not $runtimeRootPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "RuntimeRoot must remain inside the project workspace."
}
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
  throw "Launcher Python not found: $Python"
}
if (-not (Test-Path -LiteralPath $DllBin -PathType Container)) {
  throw "Launcher DLL directory not found: $DllBin"
}

$resolvedDllBin = (Resolve-Path -LiteralPath $DllBin).Path
$env:PATH = "$resolvedDllBin;$env:PATH"

$buildRoot = Join-Path $projectRoot ".build\llama-launcher"
$distRoot = Join-Path $buildRoot "dist"
$workRoot = Join-Path $buildRoot "work"
$specRoot = Join-Path $buildRoot "spec"
New-Item -ItemType Directory -Force -Path $distRoot, $workRoot, $specRoot | Out-Null

& $Python -m pip install --disable-pip-version-check --quiet --no-user "pyinstaller==6.21.0"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller installation failed for the llama launcher." }

& $Python -m PyInstaller `
  --clean `
  --noconfirm `
  --onedir `
  --name "mei-llama-server" `
  --distpath $distRoot `
  --workpath $workRoot `
  --specpath $specRoot `
  (Join-Path $projectRoot "packaging\llama_launcher.py")
if ($LASTEXITCODE -ne 0) { throw "Llama launcher build failed." }

$builtLauncher = Join-Path $distRoot "mei-llama-server"
$builtExecutable = Join-Path $builtLauncher "mei-llama-server.exe"
if (-not (Test-Path -LiteralPath $builtExecutable -PathType Leaf)) {
  throw "Built llama launcher not found: $builtExecutable"
}

$launcherTarget = [System.IO.Path]::GetFullPath(
  (Join-Path $runtimeRootPath "llm\launcher")
)
$runtimePrefix = $runtimeRootPath.TrimEnd('\') + '\'
if (-not $launcherTarget.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to replace an unsafe runtime path: $launcherTarget"
}
if (Test-Path -LiteralPath $launcherTarget) {
  Remove-Item -LiteralPath $launcherTarget -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $launcherTarget | Out-Null
Get-ChildItem -LiteralPath $builtLauncher -Force |
  Copy-Item -Destination $launcherTarget -Recurse -Force

Write-Host "Llama launcher staged in $launcherTarget"
