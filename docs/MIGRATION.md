# Migration record — 2026-10-03

Destination: `D:/00_miura/03_development/miura-projects`. Requested GitHub destination: `MiuraChan/miura-projects`, private.

## Imported sources

- **grayfox**: `C:/Users/miura/Documents/Codex/2026-07-24/we/outputs/video-studio`, branch `agent/refine-dialogue-review-handoffs`, source commit `0742a875b7ba6cf5a2d890c2ff19f3475b0ad936`, plus its uncommitted working changes.
- **mei**: `C:/Users/miura/Documents/mei ling`, branch `main`, source commit `33a32b5e601f18f03938acab3c5bc8a6d477f49d`, plus its uncommitted working changes.
- **Curriculum/Mediakit**: `C:/Users/miura/Documents/Codex/2026-09-16/ri/mediakit-site`, local exported application.
- **Candidature**: `C:/Users/miura/Documents/ChatGPT/mediakit sender`, profile, application ledger, reports/evidence, CVs and a snapshot of the existing automation.

Grayfox and Mei Ling history is retained as merge ancestry without rewriting the existing repositories. Use `git log --all` to inspect it; the original commits retain their original root paths. `docs/import-manifest.json` records SHA-256 hashes of copied source bytes before Git line-ending normalization.

## Exclusions and active systems

Dependency directories, generated build/deploy output, temporary files, local environment secrets, downloaded model/runtime payloads, conversation databases and unrelated workspace material were not imported. Required Mei Ling public UI assets were included even where the old repository ignored them.

Old checkouts, installed apps, Figma files, live sites, and the scheduled candidature sender remain in place. The sender continues to write to its original directory; reconcile it before a future cutover. No automatic deployment or Figma sync was enabled. The separate original Curriculum project is referenced in `apps/curriculum/README.md` and has no full local source export in this import.

## Local runtime setup

Use separate per-app dependency installs. Grayfox and Mei Ling require their existing local tools/models for full end-to-end operation. Mei Ling also needs local environment configuration. The imported app files retain their original behavior, including references to existing machine-local voice/model paths. Copying source does not install those services.
