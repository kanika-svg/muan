# Muan (ມ່ວນ) — project rules for Claude Code

Muan is a map-first web app answering "where should we go tonight?" in Vientiane.
Phase 1: map + curated venues/events, no backend. Phase 2: check-ins via Cloudflare Workers + D1.

## Workflow rules
- NEVER commit. All changes are reviewed manually in Cursor before commit. Do not run git add/commit/push.
- Make surgical edits: find/replace the specific documented change only. No full-block rewrites — they introduce silent edits.
- Pure HTML/CSS/JS. No frameworks, no build step. Deploys to Cloudflare Pages as-is.

## Data integrity rules (non-negotiable)
- Never invent venue details: no made-up hours, prices, events, addresses, or coordinates.
- New venues/events get "verified": false until the owner confirms them from a real source; the source_url field must point to that source.
- Never fabricate popularity numbers, review counts, or "X people here" — check-in counts arrive in phase 2 from real data only.
- No unattributed superlatives ("the best bar in Vientiane") as fact.
- No photo > wrong photo. Never hotlink or guess venue images.

## Design tokens (do not drift)
- Ink #131019 / #1C1726 / #241E31 / #2E2740
- Flame #FF5A3C (primary, trending), Gold #FFC24B (rewards/badges only),
  Violet #7C5CE0 (events), Teal #1FBF9C (open-now status only), Bone #F5F1E8, Mute #8A8494
- Fonts: Space Grotesk (display/UI) + Noto Sans Lao (Lao text). Lao-first, English supports.

## Architecture notes
- Map: MapLibre GL JS + CARTO dark raster tiles (free, attribution required — keep the attribution control).
- Data: data/venues.json and data/events.json are the single source of truth in phase 1.
  They are hand-curated weekly. Expired events are auto-hidden by date, not deleted immediately.
- "No.1 tonight" in phase 1 = first verified event today (see isNo1 in app.js).
  Do not simulate check-in counts to make it look more alive.
- Phase 2 (not yet started): Cloudflare Workers + D1 for check-ins, streaks, badges.
  GPS validation must happen server-side; the client-side distance check is UX only.
