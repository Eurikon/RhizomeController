# Rhizome Community

A community for **Rhizome LE and Rhizome SXE** owners, an independent project by Twisted Cable.

Feeltune abandoned the product line. This community brings together hardware knowledge, owner experiences and new software implementations for the remaining devices.

**Zynthian Edition** is the first software project, currently in Alpha and developed against the Rhizome LE. Its application source remains in a separate repository and will be open-sourced at stable Beta. Bitwig and Ableton integrations are future directions, with no implementation available yet. SXE compatibility is not established.

[Community website](https://eurikon.github.io/RhizomeController/) · [Zynthian Edition](https://eurikon.github.io/RhizomeController/projects/zynthian-edition/) · [Discussion](https://github.com/Eurikon/RhizomeController/discussions)

## Repository contents

- `website/`: community pages, software project pages and reviewed public images.
- `tools/`: allowlisted site export, browser verification and privacy checks.
- `scripts/` and `feed/`: the existing public discussion feed and its exporter.
- `.github/workflows/`: discussion updates and manually triggered website publishing.
- `legacy-site/`: the transition page prepared for the previous website address.

## Local preview

Run `python3 tools/build-website.py`, then `python3 -m http.server 8000 --directory dist/website`. Open `http://localhost:8000/`. Browser verification uses the installed Chrome: `node tools/verify-website.mjs http://localhost:8000/`; repeat with `projects/zynthian-edition/` appended to test the project page.

The website export contains only allowlisted public files. Original photographs, application code, local settings and private development records do not belong in this repository. Existing discussions and their identifiers remain unchanged.
