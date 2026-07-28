# Grayfox Video Studio

Local-first Windows video editor for direction-aware first cuts, ranked Story Clips, and meme-beat discovery.

## Runtime

- Grayfox keeps workspace/profile/project data in memory only; onboarding appears on every launch.
- FFmpeg and FFprobe perform scene/audio analysis and render H.264/AAC MP4 files.
- Ollama with `qwen3-vl:2b-instruct` evaluates sampled video frames locally. No OpenAI key is required.
- If Ollama is unavailable, Grayfox labels and uses its measured scene/silence fallback instead of inventing an AI result.

## Development

- `npm start` — run the Electron app
- `npm run preview` — open a local HTTP preview server on port 4177 (UI only)
- `npm test` — interaction, security configuration, local-ranking and meme-score tests
- `npm run test:electron` — launch a hidden Electron window and verify onboarding plus zero persistence
- `npm run test:ffmpeg` — create three real MP4 cuts and verify duration/codecs
- `npm run test:edit` — concatenate three non-contiguous source sections and verify the rendered MP4
- `npm run test:ai` — generate a video, analyze it with local Qwen3-VL, render the selected range, and verify it with FFprobe
- `npm run test:all` — run all of the above
- `npm run dist` — run the complete suite and build the Windows portable executable

## Implemented workflows

### Video Ops

1. Import a local video.
2. Choose final use, tone tokens, and editing direction.
3. Grayfox detects scene changes and silence, samples candidate frames, and sends only those frames plus the brief to local Qwen3-VL.
4. Grayfox builds a hook/body/close timeline from multiple ranked ranges, removes measured pauses, and can reorder sections to follow the direction.
5. FFmpeg trims and concatenates the timeline into a new H.264/AAC MP4, which is shown for review with the segment count and removed duration.

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
