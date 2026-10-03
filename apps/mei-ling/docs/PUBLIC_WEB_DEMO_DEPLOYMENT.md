# MEI public web demo

## What this build is

The public demo reuses the approved Codec UI, portraits, expressions, call animation, text conversation, Daily Intel, source ratings and links, and a session debrief. It deliberately excludes microphone input, wake word, Kokoro voice, proactive calls, private instructions, approvals, and Miura's persistent conversation memory.

The desktop application remains the complete private product. The web demo is a separate runtime mode activated with `MEI_PUBLIC_DEMO=1`.

## Verified local path

Run the demo against the existing LM Studio model:

```powershell
npm.cmd run demo:local
```

Then open `http://127.0.0.1:5178/`.

The verified demo contract is available at `GET /api/config`. In public mode it reports text chat, Daily Intel, and temporary debrief as enabled; voice, microphone, wake word, proactive calls, and Memory as disabled.

## Cloud Run container

`Dockerfile` contains only the Node server, web assets, and deterministic news/briefing code. It does not copy the Electron application, local model, Whisper, Kokoro, personal database, environment files, or desktop packaging.

Required cloud secret:

- `GEMINI_API_KEY`

Default public model:

- `gemini-3.5-flash-lite`, configurable with `GEMINI_MODEL`

The Gemini request is stateless (`store=false`). The free tier must receive only public/demo content, never private conversations or creator material.

Example deployment after Google Cloud CLI authentication and secret creation:

```powershell
gcloud run deploy mei-codec-demo --source . --project YOUR_PROJECT_ID --region europe-west8 --allow-unauthenticated --min 0 --max 1 --cpu 1 --memory 512Mi --concurrency 40 --set-env-vars MEI_PUBLIC_DEMO=1,MEI_MODEL_PROVIDER=gemini,MEI_DISABLE_SCHEDULER=1,MEI_BRAIN_DB=/tmp/mei-ling-demo.sqlite --set-secrets GEMINI_API_KEY=mei-gemini-api-key:latest
```

Cloud Run's filesystem is ephemeral. That is intentional for the first demo: chat and debrief are session-only. Daily Intel can be refreshed while the instance lives, but durable scheduled Intel requires Firestore or a separate daily build later.

## Firebase front door

`firebase.json` serves the static `public` directory and rewrites `/api/**` to the `mei-codec-demo` Cloud Run service in Milan. Copy `.firebaserc.example` to `.firebaserc`, replace the placeholder project ID, and deploy only after the Cloud Run URL has passed its smoke test.

```powershell
firebase deploy --only hosting
```

Firebase Hosting adds the public HTTPS address and CDN. The same web UI can also be served directly by Cloud Run first, which is the simpler initial test.

## Cost and abuse controls

- Cloud Run: scale to zero, maximum one instance.
- Server: 20 chat requests per IP per minute and one Intel refresh per IP every five minutes.
- Browser: no provider key and no private data.
- Google project: configure Gemini/API quotas and billing alerts before public release.
- If the free model quota is exhausted, the API returns an explicit capacity message instead of falling back to a paid provider.
- Do not enable a warm instance, GPU, Cloud SQL, raw video uploads, or paid grounding.

These controls target a EUR 0 pilot but do not constitute a contractual hard spending cap. Cloud Run normally requires a billing-enabled Google Cloud project, and usage beyond free quotas can be charged. The public URL should not be announced until project quotas and alerts have been inspected.

## Current verification

- Full repository verification: 118/118 tests passed, including the dedicated public-demo privacy and capability test.
- Local public-demo smoke: HTTP 200, config public mode, health READY, voice false, memory false, written reply returned, response memory session-only.
- Browser desktop and 390x844 mobile call flows rendered correctly.
- Temporary debrief rendered correctly and did not claim persistence.
- Browser console: no warnings or errors during the tested flow.
- Container build: not yet executed because Docker, Google Cloud CLI, and Firebase CLI are not installed on this workstation.
