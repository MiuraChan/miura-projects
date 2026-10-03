# Grayfox version archive

This repository starts tracking Grayfox source from the current `0.2.0`
development state. Earlier source snapshots were not preserved as Git commits,
so the historical Windows builds are archived as GitHub Release assets without
claiming source-level history that does not exist.

## Current source

### 0.2.4

This is the one-time updater-enabled Windows build. Its stable launcher can load
checksum-verified local runtime bundles on restart, fall back to the packaged
runtime if validation fails, and roll back to the previous deployed build.
Future producer-test changes can therefore be applied without rebuilding the
portable installer.

This release also fixes saved projects being incorrectly described as a browser
preview. When a remembered project has no retained source path, Electron now
opens the video picker, reconnects the source, and continues the requested first
cut, Story Clip, or export.

- Stable launcher with atomic runtime activation
- SHA-256 verification and packaged-runtime fallback
- One-command local deployment and rollback
- Automatic source reconnection before real FFmpeg rendering
- No GitHub credential embedded in the application

#### Runtime update — 2026-07-31

- Simplified preview workspace with the obsolete timeline controls removed
- Required approve or request-changes decision after every first cut
- Visible number of cuts in the rendered timeline
- Premiere Pro XML and After Effects JSX handoffs for approved edits
- User-confirmed YouTube, TikTok, and Instagram publishing packages
- Direction matching against attached, sidecar, embedded, or local-Whisper dialogue transcripts
- Honest speech-activity fallback when no transcript is available
- Red pulsing Grayfox signal only; black header artwork removed
- Recent workflow thumbnails use a real locally captured video frame, with a gray pulse before import
- Clean full-surface video picker supports direct click and drag-and-drop

### 0.2.3
This release makes requested production duration a hard requirement instead of
a suggestion. Long-form edits now preserve chronology across distributed
sections, validate the rendered file against the target, and stop with a useful
error rather than silently returning a short clip. Grayfox also remembers the
user, export folder, and project options for the next desktop session without
retaining the source-video path.

- Explicit target duration in minutes, plus natural-language requests such as
  “give me 40 minutes”
- Duration-locked long-form planning and post-render validation
- Saved user, export folder, tone tokens, final use, direction, and target
- 40-minute end-to-end production test from a 45-minute synthetic source
- Resilient handling of damaged sections with clear user-facing warnings

### 0.2.2
This release renders distant timeline sections as isolated, validated clips
before concatenation. It avoids decoder memory pressure on long videos, recovers
usable sections from partially damaged sources, and reports skipped time ranges
instead of exposing raw FFmpeg errors. Packaging uses the locally installed and
tested Electron distribution.

- Electron desktop application and responsive browser preview
- Session-only onboarding and workspace configuration
- Profile image approval/rejection feedback
- Local Qwen3-VL candidate analysis through Ollama
- Resilient FFmpeg scene, silence, trim, isolated-segment editing, and MP4 rendering
- Story Clip ranking, meme signal, preview, and export
- Automated UI, Electron, FFmpeg, long-video, damaged-source, edit, and local-AI integration tests

## Archived Windows builds

All preserved installers are available in the
[Grayfox Windows build archive](https://github.com/MiuraChan/grayfox-video-studio/releases/tag/windows-build-archive-2026-07-28).

### 0.2.0

- `Grayfox-0.2.0-Windows.exe`

This executable predates some post-build UI and onboarding refinements in the
current source. It remains available as a historical tested artifact.

### 0.1.0

- `Grayfox-0.1.0-Windows.exe`
- `Grayfox-0.1.0-Tested-Windows.exe`
- `Grayfox-0.1.0-Recovery-Windows.exe`

These are preserved build variants. Separate matching source snapshots are not
available.

## Checksums

`SHA256SUMS.txt` is attached to the GitHub archive release. A checksum entry is
available for every archived installer.
