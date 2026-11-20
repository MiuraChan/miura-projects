# Mediakit

Source for Francesco Saccullo's published Mediakit: https://francesco-saccullo-mediakit.web.app/.

## Local development

Use Node.js 22 or later. From this directory:

```powershell
npm ci
npm run dev
npm run build
```

The repository root also provides `npm run install:curriculum`, `npm run dev:curriculum` and `npm run build:curriculum`.

## Contents and boundaries

- `src/`: React/TypeScript Mediakit interface and portrait assets, originally exported from Figma Make file `4CI2DYqkAQhjmU17nX4yEd` and updated locally.
- `public/meiling/` and `public/grayfox/`: current published web demos, independent of the desktop applications in the other repository folders.
- `public/Francesco-Saccullo_CV.pdf` and `_IT.pdf`: the existing Mediakit CVs, with prominent clickable Mei Ling and Grayfox links. Keep their scope separate from application variants.
- `../application-cvs/`: private Tech Lead, AI Engineer and Product Designer application CVs in Italian and English. These must never be copied into `public/` or added as Mediakit download options.
- `../docs/public-assets-2026-11-20.json`: read-only snapshot provenance and SHA-256 hashes of downloaded public assets.

## Publishing

Firebase Hosting site: `francesco-saccullo-mediakit`; Google Cloud project: `portfolio-33b6a`. `firebase.json` preserves the live site's routing and cache headers at import time, excluding obsolete headers for the private application CVs, which are not hosted.

Git commits do not deploy the site and do not sync Figma. This import did not change the live site. Before any authorized deployment, reconcile the latest public demos and hosting configuration: other working folders may have newer releases. Never deploy a stale `dist` over newer Mei Ling or Grayfox releases. Build locally and review the intended changes first. Use an existing authenticated Firebase login; credentials do not belong in the repository.

The source working folder remains `C:/Users/miura/Documents/Codex/2026-09-16/ri/mediakit-site`; this repository copy is not automatically synchronized with it.
