# Repository Guidelines

## Session continuation

Read [STATE.md](STATE.md), then [CONTINUE-HERE.md](CONTINUE-HERE.md) and [HANDOFF.md](HANDOFF.md) before acting. STATE is the current snapshot, CONTINUE-HERE gives the immediate workflow, and HANDOFF records inception, design and durable decisions. Update STATE and CONTINUE-HERE before handoff and refresh HANDOFF after accepted decisions. Do not re-ask settled choices or treat historical pushes as current authorization.

## Scope and layout

This repository owns the Rhizome LE/SXE community website and discussions. Zynthian Edition is the first software implementation; its application repository is separate at `../projects/zynthian-edition/` in the local workspace. Treat Bitwig and Ableton integrations as future directions. Do not claim SXE software compatibility without evidence.

`website/` contains the community home, nested project pages and shared public assets. `scripts/`, `feed/` and the existing discussion workflow maintain the latest-five feed. Preserve discussion IDs and user-authored posts.

## Development and verification

Use `python3 tools/build-website.py` to export the explicit public allowlist into ignored `dist/website/`. Serve that directory with Python's HTTP server. Verify affected pages with `node tools/verify-website.mjs <url>`; it uses installed Chrome, without extra packages. Use `--anchors-only` for bounded navigation checks.

Retain the charcoal/blue theme, responsive layout and section-label anchoring 15 px below the sticky header. Keep application-specific content on its project page. JavaScript uses two-space indentation; Python uses four. Comments explain non-obvious reasons.

## Privacy and Git

Commit only reviewed public material. Never import private application history, original hardware photos, credentials, absolute account paths, unique unit identifiers or local session data. Keep generated output and local settings ignored. Public image derivatives must retain their existing metadata removal and identifier masking.

Set `core.hooksPath` to `.githooks`. Privacy hooks inspect staging and reachable history. Eurikon is the only permitted project author/committer; use the repository's configured identity, imperative subjects of at most 50 characters, and no AI attribution.

## Publication

Publish only when the owner explicitly requests it. The site workflow runs manually, independently of discussion-feed updates. Publish only the allowlisted export. Use the community address exclusively; the previous project Pages site is retired and must not be recreated or redirected. Discussion embeds and theme URLs must use the community address while preserving the existing discussion repository and IDs. Keep HANDOFF.md, STATE.md and CONTINUE-HERE.md local and ignored.
