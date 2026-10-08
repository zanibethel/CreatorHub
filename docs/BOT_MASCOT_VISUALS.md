# CreatorHub bot mascot visuals (approved October 8, 2026)

The approved design uses the user's five 3D robotic mascot panels in Fuse (orange), Pulse (pink), Spark (cyan), Flash (yellow/blue), Harbor (teal), plus the approved Midas whale character (silver, teal and gold). This implementation uses a cropped, compressed atlas of those user-approved images. No new characters or synthetic market prices/charts were generated.

**Art asset:** `https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/mascot-family.png` stored in Supabase public bucket `creatorhub-bot-art`. Source approved imagery was provided in the design conversation; single row atlas is six 144×145 pixel cells left-to-right: Fuse, Pulse, Spark, Flash, Harbor, Midas. Future production-quality individual assets can replace the atlas without touching bot attribution.

**Display:** Reusable `src/components/BotMascot.tsx` renders profile portraits and compact flags. `TradingBotGallery.tsx` uses real, persisted per-bot virtual equity history for sparklines; when absent, it shows a truthful empty state. The Bot Lab prospect cards show assigned IDs when available, otherwise explicitly suggested IDs. Icons always link to their related bot profiles; Midas links to the research-only mover page. Atlas, Orbit, and Coil now have separately approved portrait artworks, dedicated colors, and matching small badges; all eight trading profiles appear in the Bot Lab gallery.

**Important:** This is an aesthetic/UX change only. Existing risk rules, simulated execution permissions, score thresholds, broker routing, ledger reporting, and scanner logic remain unchanged. Generated mockup prices and win statistics must never be placed into live site cards.

## Approved new portraits — October 8, 2026

| Existing bot profile ID | Codename | Palette | Public artwork |
|---|---|---|---|
| `default-diverse` | Atlas | Regal navy / silver / emerald-teal / gold | [Atlas](https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/atlas-approved-v2.png) |
| `crypto-swing-100` | Orbit | Cosmic violet / indigo / silver / gold | [Orbit](https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/orbit-approved-v2.png) |
| `squeeze-breakout-100` | Coil | Electric lime / aqua / gunmetal / gold | [Coil](https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/coil-approved-v2.png) |

The portraits are original, user-approved assets uploaded through the previously approved temporary Floot bridge into CreatorHub's own public Supabase storage bucket. The temporary import endpoint was returned to a disabled/410 state after upload.

`BotMascot` chooses the individual portrait for these three IDs at each size. Small association badges and bot-switcher buttons crop toward the mascot face, while the profile hero uses the poster portrait. Original Fuse/Pulse/Spark/Flash/Harbor/Midas assets and colors remain unchanged. All eight bot profiles now appear in the main gallery with their real virtual-equity trend or an honest unavailable message. No prices, wins, eligibility scores or trading permissions have been changed.

## Catalog — Historical Pattern Intelligence (October 8, 2026)
Catalog is a research companion (not a purchasing bot), so it does **not** receive a new virtual $100 ledger, bot profile record, broker attribution tag, or order permission.

- Approved portrait: https://cooperativeworker.floot.app/_cdn/static/98c8269b-8657-4a7e-baf4-7d8392ea0165-creatorhub-catalog-approved-20261008.png
- Mascot identity key: `catalog` with warm bronze-gold icon outline `#d7ac70`.
- Destination: `/paper-trading/historical-patterns` (existing daily and intraday read-only studies).
- Visible in the Bot Lab's **Research companions** collection, alongside Midas, and in the Historical Pattern Lab header plus individual study cards. Existing 8 purchasing bot entries remain unchanged.
- Notes: asset currently served from the temporary Floot asset-hosting bridge (`cooperativeworker.floot.app`). No CoOperative app code was changed. This cross-project asset can be moved to the CreatorHub public Supabase storage bucket later without altering any profile/strategy IDs.
- The Catalog attribution on historical studies denotes research display, **not** a stock or cryptocurrency automatically flagged for purchase.
