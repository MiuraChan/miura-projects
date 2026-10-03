# Grayfox test bug log

Live bug list for the current exhaustive test pass. New findings are recorded here before they are fixed.

| ID | Severity | Area | Reported behavior | Root cause | Status |
| --- | --- | --- | --- | --- | --- |
| GF-001 | Blocking | Onboarding / Choose folder | In the `file://` browser preview, choosing a folder does not populate a usable reference and the field appears to want a typed address. | The browser fallback used `webkitdirectory`, which exposes contained files but never a full Windows path; selecting an empty folder therefore produced no change. | Fixed and verified: browser tests use an explicit Downloads target, Electron keeps the real OS folder picker, and all 105 unit tests pass. |
| GF-002 | Blocking | Video Ops / revisions | Editing the brief or rendering a one-segment plan could leave the output visually identical to the previous cut. | Brief changes did not invalidate the already rendered cut, and one-segment AI plans used the trim-only renderer, which discarded segment effects. | Fixed and verified: changed briefs now require a new render, unchanged revision plans are rejected, every AI plan uses the edit renderer, and the FFmpeg pixel test measured a visible luma delta of 37. |
| GF-003 | High | Video Ops / tone tags | Tone tags were stored and sent to analysis, but the long-form output did not measurably follow them. | The long-form planner used the tone only in its strategy label; cut density, shot length, silence trimming, and meme confidence stayed fixed. | Fixed: deterministic energetic, balanced, and measured profiles now control those four editing decisions; the applied profile and tag count are visible in the UI and covered by automated tests. |
