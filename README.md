# miura-projects

Private repository for Francesco Saccullo's projects.

GitHub: [MiuraChan/miura-projects](https://github.com/MiuraChan/miura-projects)

| Project | Source |
| --- | --- |
| Editing App / Grayfox | [apps/editing-app](apps/editing-app) |
| Mei Ling | [apps/mei-ling](apps/mei-ling) |
| Curriculum / Mediakit | [apps/curriculum](apps/curriculum) |
| Agente per candidature | [agents/candidature](agents/candidature) |

Each app keeps its own dependencies, lockfile, runtime and deployment configuration. Install dependencies inside each app; the Electron versions differ.

## Commands

Verified with Node.js 22.23.3. From the repository root:

```powershell
npm run install:editing
npm run install:mei-ling
npm run install:curriculum
npm run test:editing
npm run test:mei-ling
npm run build:curriculum
```

Launch Grayfox with `npm run start:editing`. Before `npm run start:mei-ling`, follow the [Mei Ling setup](apps/mei-ling/README.md), create its local environment file from the example, and configure its local models and voice runtimes. Run the Mediakit with `npm run dev:curriculum`.

The candidature agent is an existing scheduled workflow with a profile, application ledger, reports and CV files. Its imported schedule is a reference snapshot, not a second running agent.

## Migration

Imported on 2026-10-03 from the current local working folders, including uncommitted source changes. Grayfox and Mei Ling's reachable source history is preserved as merge ancestry; their original commit hashes remain valid. Current source files live in the folders above. The existing repositories and running applications were left in place.

See [migration details](docs/MIGRATION.md) and [file provenance](docs/import-manifest.json). Keep this repository private: it includes personal candidate information and application records. Credentials, dependency directories, generated installers, model weights and local conversation databases are excluded.

## Verification

Grayfox: 117 tests passed. Mei Ling: syntax checks and 118 tests passed. Mediakit: production build passed. See [verification details](docs/VERIFICATION.md).
