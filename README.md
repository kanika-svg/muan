# Muan (ມ່ວນ)

Map-first guide to what's on in Vientiane tonight. Bars, cafes, events — live on a dark map,
curated weekly. ຄືນນີ້ໄປໃສດີ?

## Run locally
No build step. From the project folder:

```
python3 -m http.server 8000
```

Open http://localhost:8000 — a local server is required (fetch of JSON files fails on file://).
In Cursor, the Live Server extension works too.

## Deploy
Same as LaoWander: push the repo to GitHub, connect to Cloudflare Pages,
framework preset "None", build command empty, output directory "/".

## Weekly curation routine
1. Update `data/events.json` from the verification spreadsheet (every Thursday).
2. Only add events with a `source_url` you actually checked. Set `verified: true` only then.
3. Expired events hide automatically — clean them out monthly.
4. New venues go in `data/venues.json`; coordinates from Google Maps (right-click → copy).

## Roadmap
- **Phase 1 (this repo):** map, pins, venue pages, curated events. Ship it, share it, get reactions.
- **Phase 2:** Cloudflare Workers + D1 — accounts (Google sign-in), GPS-validated check-ins,
  streaks, real "here now" counts, trending ranking.
- **Phase 3:** badges, friends, venue reward deals, share-to-story.

## Before public launch
- Replace ALL placeholder venues/events with verified data (see CLAUDE.md rules).
- Custom domain (also pending for LaoWander — same purchase trip).
- Add PWA manifest + icons for add-to-home-screen.
- Attribution: keep the OpenStreetMap/CARTO credit visible — it is a license requirement.
  If traffic grows past hobby scale, switch to a paid tile plan or self-hosted tiles.
