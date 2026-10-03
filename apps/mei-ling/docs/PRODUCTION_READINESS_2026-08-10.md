# Production readiness — 2026-08-10

## Decision

Do not deploy the three products as one always-on virtual machine. The approved first release targets EUR 0 recurring cloud cost: keep AI, speech, and rendering local; use only free static hosting, small data quotas, and scale-to-zero endpoints for the public layer. The complete decision and anti-cost controls are in `docs/ZERO_COST_LAUNCH_PLAN.md`. MEI is the only app changed in this pass. Grayfox passed its complete local suite. The Evangelion / Manga Title Card Generator source has not been located and therefore cannot be tested or deployed yet.

## MEI / Mei Ling Codec

### Public web demo

- A separate `MEI_PUBLIC_DEMO=1` runtime now supports written conversation, Daily Intel, source cards, and temporary debrief without shipping the 8.3 GiB desktop bundle.
- Public mode disables voice, microphone, wake word, proactive calls, private Memory, instruction writes, approvals, and persistent chat storage.
- A stateless Gemini provider and a Cloud Run container are prepared; Firebase Hosting can front `/api/**` through the included rewrite.
- Local HTTP, desktop viewport, and 390x844 mobile viewport smoke tests passed without browser console errors.
- Deployment remains pending because Docker, Google Cloud CLI, Firebase CLI, Google project selection, and the Gemini cloud secret are not configured on this workstation.
- Detailed runbook: `docs/PUBLIC_WEB_DEMO_DEPLOYMENT.md`.

### Implemented in this pass

- Activated the standing rule `miura-gaming-news-only-v1` in the real local database.
- Generic requests such as `Ciao mi dai le notizie di oggi` and `ok cerca news gaming` resolve to `videogiochi`, not conversational filler.
- Global discovery now checks Google News editions for Italy, United States, United Kingdom, Japan, Spain, France, Germany, and Brazil.
- Gambling, betting, casinos, lotteries, and unrelated results are rejected before response generation.
- Daily Intel is a replaceable current slot. A successful new scan deletes the previous `daily-intel` briefing; call debriefs and other memory are not deleted.
- The Intel `SYNC` control runs a real forced scan before refreshing the panel.
- Debrief preview updates after each completed user/assistant exchange without persisting duplicate history. The final call debrief remains the only persisted debrief.
- Browser cache version advanced to v13.

### Verification evidence

- `npm run verify`: 114/114 tests passed, syntax checks passed.
- Dedicated live-debrief server integration: passed and proved no briefing persistence.
- `npm run standalone:check`: bundled local runtime complete.
- Real runtime HTTP: UI returned 200; STT ready; configured LM Studio model not loaded; voice returned 503 while warming.
- Real Internet scan: all eight editions were reached after enabling the Windows system CA; results were restricted to gaming editorial/official publishers. Web startup now inherits the same secure CA behavior as desktop startup.

### Release blockers

- The currently configured local Qwen model is not automatically available in the tested non-desktop startup. Production must not depend on an operator opening LM Studio.
- A visual and microphone permission test must be completed in the signed desktop build or deployed HTTPS origin. Automated browser control is blocked for localhost by the browser security policy.
- News translation needs a model-backed translation step for non-Italian titles. Original source language and URL must remain visible.
- Global discovery is indexed-source coverage, not a literal immutable list of every gaming site. Source health and false-positive rates need monitoring.

## Recommended MEI model strategy

Fresh facts must come from retrieval, not model weights. Fine-tuning is for personality, Italian/English behavior, tool routing, ranking, and structured debrief output.

1. Baseline now: evaluate Gemma 4 E4B and 12B against the current Qwen 3 4B model on an internal fixed dataset.
2. Hosted production: use an OpenAI-compatible Gemma 4 endpoint or a managed Gemini 2.5 Flash-Lite endpoint on Vertex AI. Keep the news/RAG layer deterministic.
3. Customization: collect at least 100 high-quality accepted/rejected examples, split train/evaluation sets, then use supervised or adapter tuning. Never train factual news into the model.
4. Promotion gate: a candidate must beat the current model on intent accuracy, gaming-only precision, groundedness, Italian naturalness, tool-call validity, p95 latency, and cost per 100 calls.

Official references:

- https://ai.google.dev/gemma/docs/core
- https://cloud.google.com/vertex-ai/generative-ai/docs/models/tune-models
- https://cloud.google.com/run/pricing

## Grayfox

### Verification evidence

- 95/95 unit/integration tests passed.
- Coverage: 92.75% statements/lines, 75.08% branches, 98.38% functions.
- Electron smoke: `GRAYFOX_SMOKE_OK`.
- FFmpeg cutting: `GRAYFOX_FFMPEG_OK`.
- Real edit render: `GRAYFOX_EDIT_OK`.
- Damaged/long media resilience: `GRAYFOX_EDIT_RESILIENCE_OK`.
- MP4, ProRes MOV, and WebM: `GRAYFOX_FORMATS_OK`.
- Local Qwen vision integration: `GRAYFOX_LOCAL_AI_OK`.

### Cloud architecture required before release

- Web/API service: Cloud Run.
- Uploads and rendered media: Cloud Storage with short-lived signed URLs.
- Long FFmpeg work: Cloud Run Jobs or a Compute Engine worker, never a synchronous web request.
- Queue and status events: Pub/Sub.
- Metadata: Cloud SQL PostgreSQL or Firestore after a data-access evaluation.
- AI analysis: Vertex AI or a separately autoscaled model endpoint.

The current Electron app is locally production-capable, but it is not yet a multi-user cloud application.

## Evangelion / Manga Title Card Generator

Status: blocked before testing. Repository searches found only the project name in the animated portfolio, not the generator source, package manifest, or deployed URL.

Required input: the exact local folder, Git repository, or live URL. Once supplied, run dependency audit, unit tests, export tests, responsive/visual checks, font and asset license checks, security headers, accessibility checks, and a Google deployment smoke test.

## Google Cloud release gates

- Zero-cost pilot is the approved default; any paid service requires explicit approval and a monthly ceiling.

- Separate dev and production projects or at minimum separate services and databases.
- Region near the primary user base, normally `europe-west1` or another approved EU region.
- Secret Manager for credentials; no secrets in images, repositories, or frontend bundles.
- Least-privilege service accounts per app.
- Cloud Logging, Error Reporting, uptime checks, budgets, and billing alerts before public traffic.
- HTTPS, authentication where needed, rate limiting, request-size limits, content-type validation, and egress allowlists.
- Database backups and a tested restore procedure.
- Canary release and rollback artifact for every app.
- Explicit budget approval before keeping any GPU instance warm.

Cloud Run's published L4 GPU rate is USD 0.0001867 per second before CPU and memory. A permanently warm GPU can therefore become expensive; scale-to-zero or managed per-token inference is preferred until real traffic justifies standby capacity.
