# Grayfox Video Studio

Local-first Windows video editor for direction-aware first cuts, ranked Story Clips, and meme-beat discovery.

## Runtime

- Grayfox persists the user, export folder, profile, and project options locally. Source-video paths are intentionally reconnected on demand.
- FFmpeg and FFprobe perform scene/audio analysis and render H.264/AAC MP4 files.
- Dialogue-aware direction uses an attached, matching sidecar, or embedded `.srt`/`.vtt` transcript. A configured local Whisper executable is also supported. Without real words, Grayfox explicitly reports its speech-activity-only fallback.
- Ollama with `qwen3-vl:2b-instruct` evaluates sampled video frames locally. No OpenAI key is required.
- If Ollama is unavailable, Grayfox labels and uses its measured scene/silence fallback instead of inventing an AI result.

## Development

- `npm start` — run the Electron app
- `npm run preview` — open a local HTTP preview server on port 4177 (UI only)
- `npm test` — interaction, security configuration, local-ranking and meme-score tests
- `npm run test:electron` — launch a hidden Electron window and verify onboarding, the desktop bridge, and preference persistence
- `npm run test:ffmpeg` — create three real MP4 cuts and verify duration/codecs
- `npm run test:edit` — concatenate three non-contiguous source sections and verify the rendered MP4
- `npm run test:ai` — generate a video, analyze it with local Qwen3-VL, render the selected range, and verify it with FFprobe
- `npm run test:all` — run all of the above
- `npm run dist` — run the complete suite and build the Windows portable executable
- `npm run deploy:update-local` — atomically deploy a checksum-verified runtime update; restart Grayfox to activate it
- `npm run rollback:update-local` — switch the local runtime pointer back to the previous deployed build

## Installer and local updates

Grayfox 0.2.4 introduces a stable launcher. Install an updater-enabled build once;
subsequent producer-test changes can be deployed as small runtime bundles without
rebuilding the Windows executable. The launcher verifies every bundled file
against its SHA-256 manifest and falls back to the packaged runtime if validation
fails. Local updates never contain a GitHub token. A signed remote feed can be
connected later for end-user distribution.

## Implemented workflows

### Video Ops

1. Import a local video.
2. Choose final use, tone tokens, and editing direction.
3. Optionally attach an `.srt` or `.vtt` transcript. Grayfox also checks matching sidecars and embedded subtitles before falling back to locally configured Whisper or speech activity.
4. Grayfox detects scene changes and silence, samples candidate frames, and sends only those frames plus the brief to local Qwen3-VL.
5. Grayfox builds a hook/body/close timeline from multiple ranked ranges, protects dialogue boundaries, and prioritizes spoken terms that match the editing direction.
6. FFmpeg trims and concatenates the timeline into a new H.264/AAC MP4. The simplified review view shows the rendered preview and number of cuts.
7. Approve the cut or request a revision with concrete notes. Export and handoff remain locked until approval.
8. An approved cut can create a Premiere XML, an After Effects JSX composition, or a YouTube/TikTok/Instagram publishing package. Social publishing always requires the user to confirm the post in the platform UI.

### Story Clips

1. Choose target length, platform, and tone.
2. Grayfox returns three real ranges ranked by local vision and measured media signals.
3. Every candidate shows an edit score and a separate meme score with a grounded explanation.
4. “Render clip” creates a real MP4 from the selected range.

The source file is never modified. Model output is treated as a recommendation; the measured timestamps remain reviewable before export.

## Version archive

The repository contains the current source. Historical Windows executables are
stored as GitHub Release assets rather than committed to Git. See
[`VERSIONS.md`](./VERSIONS.md) for the exact archive inventory and limitations.
