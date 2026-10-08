# CreatorHub bot mascot visuals (approved October 8, 2026)

The approved design uses the user's five 3D robotic mascot panels in Fuse (orange), Pulse (pink), Spark (cyan), Flash (yellow/blue), Harbor (teal), plus the approved Midas whale character (silver, teal and gold). This implementation uses a cropped, compressed atlas of those user-approved images. No new characters or synthetic market prices/charts were generated.

**Art asset:** `https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/mascot-family.png` stored in Supabase public bucket `creatorhub-bot-art`. Source approved imagery was provided in the design conversation; single row atlas is six 144×145 pixel cells left-to-right: Fuse, Pulse, Spark, Flash, Harbor, Midas. Future production-quality individual assets can replace the atlas without touching bot attribution.

**Display:** Reusable `src/components/BotMascot.tsx` renders profile portraits and compact flags. `TradingBotGallery.tsx` uses real, persisted per-bot virtual equity history for sparklines; when absent, it shows a truthful empty state. The Bot Lab prospect cards show assigned IDs when available, otherwise explicitly suggested IDs. Icons always link to their related bot profiles; Midas links to the research-only mover page. All three non-approved roster bots keep initials until their characters are approved.

**Important:** This is an aesthetic/UX change only. Existing risk rules, simulated execution permissions, score thresholds, broker routing, ledger reporting, and scanner logic remain unchanged. Generated mockup prices and win statistics must never be placed into live site cards.
