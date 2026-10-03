param(
  [string]$VoicePython = "C:\tmp\mei-kokoro-cpu-env\Scripts\python.exe",
  [string]$SttPython = "C:\tmp\mei-stt-env\Scripts\python.exe",
  [string]$RuntimeRoot = "",
  [switch]$SkipVoice,
  [string]$SttRuntimeBin = "C:\tmp\mei-miniforge\Library\bin"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:PYTHONNOUSERSITE = "1"
if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $PSScriptRoot "runtime" }
$runtimeRootPath = [System.IO.Path]::GetFullPath($RuntimeRoot)
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if (-not $runtimeRootPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "RuntimeRoot must remain inside the project workspace."
}
if (-not $SkipVoice -and -not (Test-Path -LiteralPath $VoicePython -PathType Leaf)) {
  throw "Voice Python not found: $VoicePython"
}
if (-not (Test-Path -LiteralPath $SttPython -PathType Leaf)) { throw "STT Python not found: $SttPython" }

$buildRoot = Join-Path $projectRoot ".build\pyinstaller"
$distRoot = Join-Path $buildRoot "dist"
$workRoot = Join-Path $buildRoot "work"
$specRoot = Join-Path $buildRoot "spec"
New-Item -ItemType Directory -Force -Path $distRoot, $workRoot, $specRoot | Out-Null

if (-not $SkipVoice) {
  Remove-Item Env:\SETUPTOOLS_USE_DISTUTILS -ErrorAction SilentlyContinue
  & $VoicePython -m pip install --disable-pip-version-check --quiet --no-user "pyinstaller==6.21.0"
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller installation failed for the voice runtime." }
}

if (-not $SkipVoice) {
  Remove-Item Env:\SETUPTOOLS_USE_DISTUTILS -ErrorAction SilentlyContinue
  & $VoicePython -m PyInstaller `
    --clean `
    --noconfirm `
    --onedir `
    --name "mei-voice" `
    --distpath (Join-Path $distRoot "voice") `
    --workpath (Join-Path $workRoot "voice") `
    --specpath $specRoot `
    --collect-all "kokoro" `
    --collect-all "misaki" `
    --collect-all "en_core_web_sm" `
    --collect-all "espeakng_loader" `
    --collect-data "language_tags" `
    (Join-Path $projectRoot "local_voice.py")
  if ($LASTEXITCODE -ne 0) { throw "Voice runtime build failed." }
}

$env:SETUPTOOLS_USE_DISTUTILS = 'stdlib'
& $SttPython -m pip install --disable-pip-version-check --quiet --no-user "pyinstaller==6.21.0"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller installation failed for the STT runtime." }

if (-not (Test-Path -LiteralPath $SttRuntimeBin -PathType Container)) {
  throw "STT runtime DLL directory not found: $SttRuntimeBin"
}
$resolvedSttRuntimeBin = (Resolve-Path -LiteralPath $SttRuntimeBin).Path
$env:PATH = "$resolvedSttRuntimeBin;$env:PATH"
& $SttPython -m PyInstaller `
  --clean `
  --noconfirm `
  --onedir `
  --name "mei-stt" `
  --distpath (Join-Path $distRoot "stt") `
  --workpath (Join-Path $workRoot "stt") `
  --specpath $specRoot `
  --collect-all "faster_whisper" `
  --collect-all "ctranslate2" `
  --collect-all "av" `
  (Join-Path $projectRoot "local_stt.py")
if ($LASTEXITCODE -ne 0) { throw "STT runtime build failed." }

$voiceTarget = Join-Path $runtimeRootPath "voice"
$sttTarget = Join-Path $runtimeRootPath "stt"
$targets = @($sttTarget)
if (-not $SkipVoice) { $targets = @($voiceTarget) + $targets }
foreach ($target in $targets) {
  $resolvedTarget = [System.IO.Path]::GetFullPath($target)
  if (-not $resolvedTarget.StartsWith($runtimeRootPath.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace an unsafe runtime path: $resolvedTarget"
  }
  if (Test-Path -LiteralPath $resolvedTarget) { Remove-Item -LiteralPath $resolvedTarget -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $resolvedTarget | Out-Null
}

if (-not $SkipVoice) {
  Copy-Item -LiteralPath (Join-Path $distRoot "voice\mei-voice") -Destination $voiceTarget -Recurse
}
Copy-Item -LiteralPath (Join-Path $distRoot "stt\mei-stt") -Destination $sttTarget -Recurse
Write-Host "Python runtimes staged in $runtimeRootPath"
