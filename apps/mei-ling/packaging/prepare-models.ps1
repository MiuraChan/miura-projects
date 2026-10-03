param(
  [string]$RuntimeRoot = "",
  [string]$QwenSource = "C:\Users\miura\.lmstudio\models\lmstudio-community\Qwen3-4B-Instruct-2507-GGUF\Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  [string]$WhisperSmallCache = "C:\Users\miura\.cache\huggingface\hub\models--Systran--faster-whisper-small",
  [string]$WhisperTinySource = "C:\tmp\mei-stt-cache\faster-whisper-tiny",
  [string]$KokoroHome = "C:\tmp\mei-kokoro-cache",
  [string]$LlamaArchiveUrl = "https://github.com/ggml-org/llama.cpp/releases/download/b10253/llama-b10253-bin-win-cpu-x64.zip"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $PSScriptRoot "runtime" }
$runtimeRootPath = [System.IO.Path]::GetFullPath($RuntimeRoot)
if (-not $runtimeRootPath.StartsWith($projectRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "RuntimeRoot must remain inside the project workspace."
}

function Reset-SafeDirectory([string]$Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith($runtimeRootPath.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace an unsafe path: $fullPath"
  }
  if (Test-Path -LiteralPath $fullPath) { Remove-Item -LiteralPath $fullPath -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Directory not found: $Source" }
  Reset-SafeDirectory $Destination
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

if (-not (Test-Path -LiteralPath $QwenSource -PathType Leaf)) { throw "Qwen model not found: $QwenSource" }
$smallSnapshot = Get-ChildItem -LiteralPath (Join-Path $WhisperSmallCache "snapshots") -Directory -ErrorAction Stop |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $smallSnapshot) { throw "Faster Whisper Small snapshot not found." }

$modelRoot = Join-Path $runtimeRootPath "models"
$qwenTarget = Join-Path $modelRoot "qwen"
Reset-SafeDirectory $qwenTarget
Copy-Item -LiteralPath $QwenSource -Destination (Join-Path $qwenTarget "qwen3-4b-instruct-2507-q4_k_m.gguf")
Copy-DirectoryContents $smallSnapshot.FullName (Join-Path $modelRoot "faster-whisper-small")
Copy-DirectoryContents $WhisperTinySource (Join-Path $modelRoot "faster-whisper-tiny")
Copy-DirectoryContents $KokoroHome (Join-Path $modelRoot "kokoro")

$downloadRoot = Join-Path $projectRoot ".build\downloads"
$expandRoot = Join-Path $projectRoot ".build\llama-cpu"
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
$llamaArchive = Join-Path $downloadRoot "llama-b10253-bin-win-cpu-x64.zip"
if (-not (Test-Path -LiteralPath $llamaArchive -PathType Leaf)) {
  Invoke-WebRequest -Uri $LlamaArchiveUrl -OutFile $llamaArchive
}
if (Test-Path -LiteralPath $expandRoot) { Remove-Item -LiteralPath $expandRoot -Recurse -Force }
Expand-Archive -LiteralPath $llamaArchive -DestinationPath $expandRoot -Force
$llamaServerImpl = Get-ChildItem -LiteralPath $expandRoot -Filter "llama-server-impl.dll" -File -Recurse | Select-Object -First 1
if (-not $llamaServerImpl) { throw "llama-server-impl.dll was not found in the official archive." }
$llmTarget = Join-Path $runtimeRootPath "llm"
Reset-SafeDirectory $llmTarget
Get-ChildItem -LiteralPath $llamaServerImpl.Directory.FullName -Filter "*.dll" -File |
  Copy-Item -Destination $llmTarget -Force

$licenseRoot = Join-Path $runtimeRootPath "licenses"
Reset-SafeDirectory $licenseRoot
Invoke-WebRequest -Uri "https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/raw/main/LICENSE" -OutFile (Join-Path $licenseRoot "QWEN3-APACHE-2.0.txt")
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ggml-org/llama.cpp/master/LICENSE" -OutFile (Join-Path $licenseRoot "LLAMA-CPP-MIT.txt")
Write-Host "Models and llama.cpp staged in $runtimeRootPath"
