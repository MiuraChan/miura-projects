# Verification — 2026-10-03

Verified in `D:/00_miura/03_development/miura-projects` with Node.js 22.23.3.

| Check | Result |
| --- | --- |
| Original copied file hashes | 221/221 matched source SHA-256 |
| Original Grayfox and Mei Ling commit ancestry | Both source heads reachable from main |
| Original Grayfox and Mei Ling working trees | Unchanged by import |
| Grayfox `npm run test:editing` | 117 tests passed across 8 files; coverage thresholds passed |
| Mei Ling `npm run test:mei-ling` | Syntax checks and all 118 tests passed |
| Mediakit `npm run build:curriculum` | Production build passed |
| Application ledger | 265 JSON records parsed successfully |
| Selected CV and public CV | Valid PDF signatures; copied bytes preserved |
| Firebase Hosting target | Still francesco-saccullo-mediakit |
| Tracked generated files and local secrets | No unexpected environment, database, dependency, runtime or build files |
| Common credential patterns in Git history | 275 text blobs checked; no findings after excluding two exact example.com test fixtures |
| Largest imported Git blob | 2,961,152 bytes |
| GitHub repository | MiuraChan/miura-projects; private; main pushed |

This checks the source import, existing automated tests and website build. Full desktop interaction, voice/model setup, actual video rendering, live publishing and candidature submissions were not exercised.

## Windows certificate setup

The first Mediakit dependency install encountered a certificate-chain error. Retrying with Windows' trusted certificate store succeeded while keeping TLS verification enabled:

```powershell
$env:NODE_OPTIONS = '--use-system-ca'
npm run install:curriculum
```

The new local Git repository uses `http.sslBackend=schannel` for the same reason. This is scoped to this repository; the global Git configuration was not changed.

## Active workflow boundary

The candidature import is a snapshot. Its live scheduler still reads and writes the original `C:/Users/miura/Documents/ChatGPT/mediakit sender` directory. Existing checkouts, installed apps, Figma projects and deployed sites remain in place.
