# Zero-cost launch plan — 2026-08-10

## Product decision

Launch the first public version with a target recurring cloud bill of EUR 0. This is a local-first product strategy, not an always-on cloud replica of the desktop applications.

The public layer demonstrates the products and handles light interactions. Heavy AI inference, speech recognition, voice synthesis, and video rendering stay on the creator's machine. Free cloud quotas are used only where they provide clear value.

## Shared free architecture

- Static public interfaces and portfolio pages: Firebase Hosting on the Spark plan.
- Lightweight metadata, public news cards, and debrief records: Cloud Firestore within the Spark quotas.
- Optional small stateless API: Cloud Run with request-based billing, `min-instances=0`, `max-instances=1`, low CPU/RAM limits, and a strict application rate limit.
- Assistant fallback: Gemini Developer API free tier, with a daily request ceiling in the application. It must never be the only way to use the desktop assistant, and it receives only public/demo content because Google's free tier may use submitted content to improve its products.
- Gaming news: the existing source retrieval engine. The language model filters, ranks, translates, and summarizes retrieved evidence; it does not invent or memorize current news.
- Secrets remain server-side or local. No provider key is shipped in browser JavaScript.
- Private conversations, personal memory, debriefs, credentials, and unpublished creator material never go to a free cloud model; they stay local unless Miura explicitly chooses a suitable private paid service later.

## App boundaries

### MEI / Mei Ling Codec

- Desktop remains the complete experience: local model, Faster Whisper, Kokoro, codec audio, portraits, expressions, Intel, debrief, and memory.
- Public web version is a portfolio demo with text interaction and a limited free-model fallback.
- Daily Intel is replaceable transient data. It is not long-term memory.
- News results keep source, date, rating, verification state, and HTTPS link.
- No always-on GPU and no paid speech API in the zero-cost phase.

### Grayfox

- Electron, FFmpeg rendering, and local visual analysis remain local.
- Public site explains the workflow, accepts no large cloud video render jobs, and can offer the desktop build when distribution is ready.
- Project metadata and very small demo assets may use the free hosting/database quotas.

### Evangelion / Manga Title Card Generator

- Prefer a fully client-side web build: fonts and licensed assets are bundled, composition runs in the browser, and export is performed locally.
- Firebase Hosting serves the static app.
- Production verification starts only when the actual repository or deployed source is located.

## Anti-cost controls

- Do not enable a continuously warm instance, Cloud SQL, a GPU, video transcoding workers, or paid search grounding.
- Cloud Run scales to zero and is capped at one instance.
- Enforce per-IP and per-session request limits before exposing an AI endpoint.
- Set provider quota ceilings where supported and create budget alerts. A budget alert is a warning, not a hard spending cap.
- Store only compact structured records; expire temporary records and never upload raw videos by default.
- If a free quota is exhausted, show a clear “free capacity exhausted” state and fall back to local mode instead of silently spending money.
- Review usage weekly during the public pilot.

## Upgrade triggers

Paid infrastructure is considered only after one of these events:

1. A product generates recurring revenue or secures a sponsor/employer budget.
2. Real users repeatedly exhaust a free quota.
3. An always-on feature has measured demand and a defined monthly ceiling.
4. Cloud rendering materially improves a validated workflow.

Every upgrade needs a cost estimate, a hard operational ceiling, a rollback path, and an owner.

## Portfolio narrative

> Three creator tools began with zero recurring infrastructure cost by treating the desktop as the workstation and the cloud as a thin public layer. The architecture is deliberately ready to grow: revenue unlocks managed inference, collaborative storage, cloud rendering, and an always-available voice assistant without rewriting the products.

This decision demonstrates product judgment: prove usefulness first, measure demand, then buy infrastructure only for features users actually value.

## Official pricing references checked on 2026-08-10

- Firebase pricing: https://firebase.google.com/pricing
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Gemini Developer API pricing: https://ai.google.dev/gemini-api/docs/pricing
