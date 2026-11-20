# Private application CVs

Three role-focused CVs, each in Italian and English: Tech Lead, AI Engineer and Product Designer. `output/pdf/` contains the six PDFs and their ZIP bundle for manual LinkedIn applications. They are intentionally outside the Mediakit public assets.

On Windows, install Python dependencies `reportlab` and `pypdf`, then run `python tools/build_targeted_cvs.py` from this folder. The generator uses the installed Arial and Consolas fonts. Review all rendered pages after changing content. It writes only this folder's output and does not deploy anything.

These files do not alter the candidature agent's active schedule or its selected attachments. The agent remains under `agents/candidature` with its existing configuration.
