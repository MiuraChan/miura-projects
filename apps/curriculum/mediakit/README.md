# Francesco Saccullo Mediakit

Published: https://francesco-saccullo-mediakit.web.app/
Google Cloud / Firebase project: portfolio-33b6a
Firebase Hosting site: francesco-saccullo-mediakit (dedicated site)
Plan verified at publication: Spark.

Source copied from Figma Make Mediakit version 115, file 4CI2DYqkAQhjmU17nX4yEd.
App.tsx and index.css preserve the original UI. Vite configuration replaces Figma-only preview integrations. index.html supplies an English page title and description.

Build: npm ci, then npm run build.
Deploy with an authenticated Firebase CLI: firebase deploy --only hosting --project portfolio-33b6a
firebase.json explicitly targets the dedicated site; other project sites are not modified.

Verified: production build; public HTTPS page; navigation; profile image; all three project images; matching 16:9 frames; social links and gaming aspiration text; mobile menu and no horizontal overflow at 390px.


2026-09-30: Profile includes DOWNLOAD CV (PDF). Static snapshot: public/Francesco-Saccullo_CV.pdf (one Profile page, 264600 bytes). Regenerate this PDF whenever Profile content changes. Firebase serves it with attachment filename Francesco-Saccullo_CV.pdf. Figma copy updated to version 116 with the same download link.
